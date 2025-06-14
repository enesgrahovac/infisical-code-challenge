import { useState } from "react";

function HomePage() {
    const [secret, setSecret] = useState("");
    const [expires, setExpires] = useState(1);
    const [password, setPassword] = useState("");
    const [maxViews, setMaxViews] = useState<number | "">("");
    const [email, setEmail] = useState("");
    const [link, setLink] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const body: { secret: string; expiresInDays: number; password?: string; maxViews?: number; email?: string } = {
                secret,
                expiresInDays: Number(expires),
            };
            if (password) body.password = password;
            if (maxViews) body.maxViews = Number(maxViews);
            if (email) body.email = email;

            const r = await fetch("http://localhost:8000/api/secret", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error("Failed to create secret");
            const data = await r.json();
            const shareLink = `${window.location.origin}/share/${data.shareId}`;
            setLink(shareLink);
            setSecret("");
            setPassword("");
            setMaxViews("");
            setEmail("");
            setEmailError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-start pt-20 bg-gray-100 px-4">
            <h1 className="text-3xl font-semibold mb-6">Create a SneakyLink</h1>

            <form className="w-full max-w-xl space-y-4" onSubmit={handleSubmit}>
                <div>
                    <label className="block font-medium mb-1">Secret</label>
                    <textarea
                        className="w-full border rounded p-2"
                        rows={4}
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        onInvalid={(e) => e.currentTarget.setCustomValidity("A secret value is required to create a link")}
                        onInput={(e) => e.currentTarget.setCustomValidity("")}
                        required
                    />
                </div>

                <div className="flex space-x-4">
                    <div className="flex-1">
                        <label className="block font-medium mb-1">Expires in (days)</label>
                        <input
                            type="number"
                            min={1}
                            max={30}
                            className="w-full border rounded p-2"
                            value={expires}
                            onChange={(e) => setExpires(Number(e.target.value))}
                            required
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block font-medium mb-1">Max views (optional)</label>
                        <input
                            type="number"
                            min={1}
                            className="w-full border rounded p-2"
                            value={maxViews}
                            onChange={(e) => {
                                const v = e.target.value;
                                setMaxViews(v === "" ? "" : Number(v));
                            }}
                        />
                    </div>
                </div>

                <div>
                    <label className="block font-medium mb-1">Password (optional)</label>
                    <input
                        type="password"
                        className="w-full border rounded p-2"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <div>
                    <label className="block font-medium mb-1">Email for 2FA (optional)</label>
                    <input
                        type="email"
                        className="w-full border rounded p-2"
                        value={email}
                        onChange={(e) => {
                            const val = e.target.value;
                            setEmail(val);
                            if (val === "") {
                                setEmailError(null);
                            } else {
                                // Basic email regex
                                const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
                                setEmailError(ok ? null : "Invalid email format");
                            }
                        }}
                    />
                    {emailError && <p className="text-red-600 mt-1 text-sm">{emailError}</p>}
                </div>

                <button
                    type="submit"
                    disabled={loading || emailError !== null}
                    className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? "Creating…" : "Generate Link"}
                </button>
            </form>

            {error && <p className="text-red-600 mt-4">{error}</p>}
            {link && (
                <div className="mt-6 bg-white p-4 rounded shadow w-full max-w-xl">
                    <p className="font-medium mb-2">Share this link:</p>
                    <div className="flex items-center space-x-2">
                        <input
                            readOnly
                            className="flex-1 border rounded p-2"
                            value={link}
                        />
                        <button
                            className="bg-gray-200 px-3 py-2 rounded"
                            onClick={() => navigator.clipboard.writeText(link)}
                        >
                            Copy
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default HomePage;
