import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "crypto";
import argon2 from "argon2";
import nodemailer from "nodemailer";
dotenv.config();

const app = express();
import { db } from "./db/knex";

//middleware
app.use(cors());
app.use(helmet());

// basic rate limiting (100 requests / 15 min per IP)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);
app.use(express.json());

// ----- Mail transport (Maildev in dev) -----
const mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-server",
    port: Number(process.env.SMTP_PORT || 1025),
    secure: false,
});

/*
##################################################
||                                              ||
||          Secret-share core endpoints         ||
||                                              ||
##################################################
*/

const createSecretSchema = z.object({
    secret: z.string().min(1),
    expiresInDays: z.number().int().positive().max(30),
    password: z.string().min(1).max(128).optional(),
    maxViews: z.number().int().positive().optional(),
    email: z.string().email().optional(),
});

app.post("/api/secret", async (req, res) => {
    try {
        const { secret, expiresInDays, password, maxViews, email } = createSecretSchema.parse(req.body);

        // Generate unique id (uuid v4) which doubles as the key derivation seed
        const id = randomUUID();

        // Derive 256-bit key from id using PBKDF2 + env salt
        const salt = process.env.SECRET_SALT || "default_secret_salt_change_me";
        const key = pbkdf2Sync(id, salt, 100_000, 32, "sha256");

        // Encrypt secret using AES-256-GCM
        const iv = randomBytes(12); // 96-bit IV for GCM
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const encryptedBuf = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const encryptedSecret = Buffer.concat([encryptedBuf, authTag]); // store ciphertext||tag together

        // Password hashing (optional)
        let passwordHash: string | undefined = undefined;
        if (password) {
            passwordHash = await argon2.hash(password);
        }

        // Expiry + view counters
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        await db("shared_secrets").insert({
            id,
            encrypted_secret: encryptedSecret,
            iv,
            expires_at: expiresAt,
            max_views: maxViews ?? null,
            views_remaining: maxViews ?? null,
            password_hash: passwordHash ?? null,
            email: email ?? null,
            otp_verified: email ? false : true,
        });

        void res.status(201).json({ shareId: id });
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            void res.status(400).json({ error: err.flatten() });
            return;
        }
        console.error("/api/secret error", err);
        void res.status(500).json({ error: "Internal Server Error" });
        return;
    }
});

// ------------------------ Unlock endpoint ----------------------------
const unlockBodySchema = z.object({
    password: z.string().min(1).optional(),
    twoFACode: z.string().length(6).optional(),
});

app.post("/api/secret/:id/unlock", async (req, res) => {
    const { id } = req.params;
    try {
        const { password, twoFACode } = unlockBodySchema.parse(req.body ?? {});

        const salt = process.env.SECRET_SALT || "default_secret_salt_change_me";

        // Use a transaction for atomic view decrement / deletion
        const result = await db.transaction(async (trx) => {
            const record = await trx("shared_secrets").where({ id }).forUpdate().first();

            if (!record) return { status: 404 } as const;

            // Expiration check
            if (new Date(record.expires_at) < new Date()) {
                await trx("shared_secrets").where({ id }).delete();
                return { status: 410 } as const; // Gone
            }

            // View limit check
            if (record.max_views && record.views_remaining <= 0) {
                await trx("shared_secrets").where({ id }).delete();
                return { status: 410 } as const;
            }

            // Password check
            if (record.password_hash) {
                if (!password) return { status: 401 } as const;
                const ok = await argon2.verify(record.password_hash, password);
                if (!ok) return { status: 401 } as const;
            }

            // 2FA check
            if (record.email && !record.otp_verified) {
                const now = new Date();

                if (!twoFACode) {
                    // if a valid code already exists, just prompt user without resending
                    if (record.otp_hash && record.otp_expires_at && new Date(record.otp_expires_at) > now) {
                        return { status: 401 as const, require2FA: true };
                    }

                    // generate & email new code
                    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
                    const codeHash = await argon2.hash(code);
                    const expiry = new Date(now.getTime() + 10 * 60 * 1000); // 10 min

                    await trx("shared_secrets").where({ id }).update({ otp_hash: codeHash, otp_expires_at: expiry });

                    mailTransport
                        .sendMail({
                            from: process.env.SMTP_FROM || "no-reply@infisical.local",
                            to: record.email,
                            subject: "Your secret-share verification code",
                            text: `Your Infisical secret verification code is ${code}. It is valid for 10 minutes.`,
                        })
                        .catch((mailErr) => {
                            console.error("[mail] sendMail failed", mailErr);
                        });

                    return { status: 401 as const, require2FA: true };
                }

                // verify provided code
                if (!record.otp_hash || !record.otp_expires_at || new Date(record.otp_expires_at) < now) {
                    return { status: 401 as const, require2FA: true };
                }

                const codeOk = await argon2.verify(record.otp_hash, twoFACode);
                if (!codeOk) {
                    return { status: 401 as const, require2FA: true };
                }

                // success: mark verified and continue
                await trx("shared_secrets").where({ id }).update({ otp_verified: true });
            }

            // Derive key and decrypt
            const key = pbkdf2Sync(id, salt, 100_000, 32, "sha256");
            const iv: Buffer = record.iv;
            const enc: Buffer = record.encrypted_secret;
            const authTag = enc.slice(enc.length - 16);
            const ciphertext = enc.slice(0, enc.length - 16);

            const decipher = createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(authTag);
            const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

            // Update views_remaining if needed
            if (record.max_views) {
                const remaining = record.views_remaining - 1;
                if (remaining <= 0) {
                    await trx("shared_secrets").where({ id }).delete();
                } else {
                    await trx("shared_secrets").where({ id }).update({ views_remaining: remaining, updated_at: trx.fn.now() });
                }
            }

            return { status: 200, secret: plaintext } as const;
        });

        if (result.status === 401 && (result as any).require2FA) {
            res.status(401).json({ require2FA: true });
            return;
        }
        if (result.status !== 200) {
            res.sendStatus(result.status);
            return;
        }
        void res.json({ secret: result.secret });
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            void res.status(400).json({ error: err.flatten() });
            return;
        }
        console.error("unlock error", err);
        void res.status(500).json({ error: "Internal Server Error" });
        return;
    }
});

/*
##################################################
||                                              ||
||              Example endpoints               ||
||                                              ||
##################################################
*/

// Root endpoint - Returns a simple hello world message and default client port
app.get("/", async (_req, res) => {
    res.json({ hello: "world", "client-default-port": 3000 });
});

// GET /examples - Fetches all records from the example_foreign_table
app.get("/examples", async (_req, res) => {
    const docs = await db("example_foreign_table").select("*");
    res.json({ docs });
});

// POST /examples - Creates a new record with auth method and name, returns the created document
app.post("/examples", async (req, res) => {
    const { authMethod, name } = req.body;
    const [doc] = await db("example_foreign_table")
        .insert({
            authMethod,
            name,
        })
        .returning("*");
    res.json({ doc });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`server has started on port ${PORT}`);
});
