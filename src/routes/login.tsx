import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Truck, Loader2 } from "lucide-react";

import { fetchCurrentUser, useAuth } from "@/shared/api/auth";
import { isApiError } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
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
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Truck className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input id="email" type="email" dir="ltr" autoFocus {...register("email")} />
              {errors.email?.message && (
                <p className="text-xs text-destructive">{t(errors.email.message)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input id="password" type="password" dir="ltr" {...register("password")} />
              {errors.password?.message && (
                <p className="text-xs text-destructive">{t(errors.password.message)}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("login.submitting")}
                </>
              ) : (
                t("login.submit")
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
