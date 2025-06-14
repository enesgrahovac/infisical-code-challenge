import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";

function SharePage() {
    const { id } = useParams();
    const [secret, setSecret] = useState<string | null>(null);
    const [password, setPassword] = useState("");
    const [needsPassword, setNeedsPassword] = useState(false);
    const [needs2FA, setNeeds2FA] = useState(false);
    const [passwordVerified, setPasswordVerified] = useState(false);
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const attemptUnlock = async (opts?: { password?: string; twoFACode?: string }) => {
        try {
            setLoading(true);
            setError(null);
            const r = await fetch(`http://localhost:8000/api/secret/${id}/unlock`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(opts ?? {}),
            });
            if (r.status === 401) {
                const data = await r.json().catch(() => null);
                if (data && data.require2FA) {
                    setNeeds2FA(true);
                    if (opts && opts.password) {
                        setPasswordVerified(true);
                        setNeedsPassword(false);
                    }
                } else {
                    setNeedsPassword(true);
                }
                return;
            }
            if (r.status === 410) {
                setError("This secret link has expired or reached its view limit.");
                return;
            }
            if (!r.ok) throw new Error("Unable to retrieve secret");
            const data = (await r.json()) as { secret: string };
            setSecret(data.secret);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!id) return;
        attemptUnlock();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (needs2FA) {
            attemptUnlock({ password, twoFACode: code });
        } else {
            attemptUnlock({ password });
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center pt-20 bg-gray-100 px-4">
            <h1 className="text-3xl font-semibold mb-6">🔗 SneakyLink</h1>

            {loading && <p>Loading…</p>}

            {error && (
                <div className="bg-red-100 text-red-700 p-4 rounded max-w-xl w-full mb-4">
                    {error}
                </div>
            )}

            {!secret && needsPassword && !passwordVerified && (
                <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
                    <p className="text-gray-700">This secret is password-protected.</p>
                    <input
                        type="password"
                        className="border rounded p-2 w-full"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <button
                        className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
                        type="submit"
                    >
                        Unlock
                    </button>
                </form>
            )}

            {!secret && needs2FA && (
                <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm mt-10">
                    {passwordVerified && (
                        <p className="text-green-600 font-medium">Password verified ✅</p>
                    )}
                    <p className="text-gray-700">A verification code was sent to the owner's email. Enter it below.</p>
                    <input
                        type="text"
                        className="border rounded p-2 w-full"
                        placeholder="6-digit code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                        maxLength={6}
                    />
                    <button
                        className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
                        type="submit"
                    >
                        Verify
                    </button>
                </form>
            )}

            {secret && (
                <div className="bg-white p-6 rounded shadow max-w-xl w-full">
                    <h2 className="font-medium mb-2">Your secret</h2>
                    <pre className="whitespace-pre-wrap break-words bg-gray-100 p-4 rounded mb-4">
                        {secret}
                    </pre>
                    <button
                        className="bg-gray-200 px-3 py-2 rounded"
                        onClick={() => navigator.clipboard.writeText(secret)}
                    >
                        Copy to clipboard
                    </button>
                </div>
            )}

            <div className="mt-8">
                <Link to="/" className="text-blue-600 hover:underline">
                    Create your own secret
                </Link>
            </div>
        </div>
    );
}

export default SharePage; 