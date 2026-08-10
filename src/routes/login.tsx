import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { fetchCurrentUser, useAuth } from "@/shared/api/auth";
import { isApiError } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const user = await fetchCurrentUser();
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const schema = z.object({
  email: z.string().min(1, "login.emailRequired"),
  password: z.string().min(1, "login.passwordRequired"),
});
type FormValues = z.infer<typeof schema>;

/** Split-pane login (design 2026-07-23): brand panel on primary, form pane on
 * the surface. Same auth flow as before — visual change only. */
function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      await navigate({ to: "/" });
    } catch (e) {
      const key =
        isApiError(e) && (e.kind === "auth_failed" || e.kind === "unauthorized")
          ? "login.wrongCredentials"
          : "login.serverError";
      setError("password", { message: key });
    }
  });

  return (
    <div className="grid min-h-screen md:grid-cols-[5fr_6fr]">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground md:flex">
        <div className="text-[15px] font-bold">
          {t("app.name")} · {t("app.tagline")}
        </div>
        <div className="max-w-[20ch] text-[28px] font-bold leading-relaxed [text-wrap:balance]">
          {t("login.brandTagline")}
        </div>
        <div className="text-xs text-primary-foreground/65">{t("login.copyright")}</div>
      </aside>

      <main className="grid place-items-center bg-card px-6 py-8">
        <div className="w-full max-w-[368px]">
          <div className="mb-7 text-[15px] font-bold md:hidden">
            {t("app.name")} · {t("app.tagline")}
          </div>
          <h1 className="text-[23px] font-bold leading-normal">{t("login.welcome")}</h1>
          <p className="mb-6 mt-0.5 text-[13.5px] text-muted-foreground">{t("login.welcomeSub")}</p>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input id="email" type="text" dir="ltr" className="text-start" autoFocus {...register("email")} />
              {errors.email?.message && (
                <p className="text-xs text-destructive">{t(errors.email.message)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input id="password" type="password" dir="ltr" {...register("password")} />
              {errors.password?.message && (
                <p className="text-xs text-destructive">{t(errors.password.message)}</p>
              )}
            </div>
            <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("login.submitting")}
                </>
              ) : (
                t("login.submit")
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
