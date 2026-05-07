/**
 * LoginPage — Phase 1 happy path:
 *   - email + password form, inline blur validation per UX §13.6
 *   - submit invokes `auth_login` Tauri command (which talks to Falcon)
 *   - on success, JWT lands in the OS keychain via the Rust core; we route to /
 *   - on AppError { kind: "auth_failed" } we surface the localised message
 *   - on AppError { kind: "http" } (network failure) we surface a "connection" message
 *
 * The visual primary action follows §13.1 — one obvious big button.
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { useAuth } from "@/shared/api/auth";
import { isAppError } from "@/shared/api/tauri";

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>(
    {},
  );

  const emailEmpty = touched.email && email.trim().length === 0;
  const passwordEmpty = touched.password && password.length === 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (email.trim().length === 0 || password.length === 0) {
      setTouched({ email: true, password: true });
      setError(t("login.errors.required"));
      return;
    }

    try {
      setSubmitting(true);
      await login(email.trim(), password);
      navigate({ to: "/" });
    } catch (e: unknown) {
      if (isAppError(e)) {
        if (e.kind === "auth_failed") {
          setError(t("login.errors.invalid_credentials"));
        } else if (e.kind === "http") {
          setError(t("login.errors.network"));
        } else {
          setError(t("login.errors.generic"));
        }
      } else {
        setError(t("login.errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLang = () => {
    const next = i18n.language?.startsWith("ar") ? "en" : "ar";
    i18n.changeLanguage(next);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center space-y-2">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center font-bold text-2xl">
          A
        </div>
        <CardTitle className="text-2xl">{t("app.title")}</CardTitle>
        <CardDescription>{t("login.subtitle")}</CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("login.email_label")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              dir="ltr"
              placeholder={t("login.email_placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              disabled={submitting}
              aria-invalid={emailEmpty || undefined}
              required
            />
            {emailEmpty && (
              <p className="text-xs text-destructive">
                {t("login.errors.required")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("login.password_label")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              placeholder={t("login.password_placeholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() =>
                setTouched((prev) => ({ ...prev, password: true }))
              }
              disabled={submitting}
              aria-invalid={passwordEmpty || undefined}
              required
            />
            {passwordEmpty && (
              <p className="text-xs text-destructive">
                {t("login.errors.required")}
              </p>
            )}
          </div>

          {error && !emailEmpty && !passwordEmpty && (
            <div
              role="alert"
              className="text-sm rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-2"
            >
              {error}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full h-11 text-base" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ms-2">{t("login.submitting")}</span>
              </>
            ) : (
              t("login.submit")
            )}
          </Button>

          <button
            type="button"
            onClick={toggleLang}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {i18n.language?.startsWith("ar") ? "English" : "العربية"}
          </button>
        </CardFooter>
      </form>
    </Card>
  );
}
