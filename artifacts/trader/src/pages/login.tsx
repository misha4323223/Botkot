import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Activity } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-8 space-y-6"
      >
        <div className="flex items-center gap-2 justify-center">
          <Activity className="text-primary" />
          <h1 className="text-2xl font-bold">AI Трейдер</h1>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Пароль</label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            placeholder="Введите пароль"
          />
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full bg-primary text-primary-foreground rounded-lg py-2 font-semibold disabled:opacity-50"
        >
          {busy ? "Вход..." : "Войти"}
        </button>
      </form>
    </div>
  );
}
