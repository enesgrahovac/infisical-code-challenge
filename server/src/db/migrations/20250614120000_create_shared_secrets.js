export async function up(knex) {
    // Ensure uuid generation extension is available
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await knex.schema.createTable("shared_secrets", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
        table.binary("encrypted_secret").notNullable();
        table.binary("iv").notNullable();
        table.timestamp("expires_at").notNullable();
        table.integer("max_views");
        table.integer("views_remaining");
        table.string("password_hash");
        table.string("email");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index(["expires_at"], "idx_shared_secrets_expires_at");
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists("shared_secrets");
} 