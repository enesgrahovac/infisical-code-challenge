export async function up(knex) {
    await knex.schema.alterTable("shared_secrets", (table) => {
        table.string("otp_hash");
        table.timestamp("otp_expires_at");
        table.boolean("otp_verified").defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable("shared_secrets", (table) => {
        table.dropColumn("otp_hash");
        table.dropColumn("otp_expires_at");
        table.dropColumn("otp_verified");
    });
} 