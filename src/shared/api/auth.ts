import { create } from "zustand";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { invoke } from "./tauri";

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  permission: number;
  driver_id: number;
  jwt_exp: number;
}

/* ---------- raw Tauri command bindings ---------- */

export async function fetchCurrentUser(): Promise<UserInfo | null> {
  return invoke<UserInfo | null>("auth_current_user");
}

export async function performLogin(email: string, password: string): Promise<UserInfo> {
  return invoke<UserInfo>("auth_login", { email, password });
}

export async function performLogout(): Promise<void> {
  return invoke<void>("auth_logout");
}

/* ---------- Zustand store + composite hook ----------
 * We keep the store tiny: just the user. Loading/error are owned by the
 * specific page using TanStack Query. The store exists so any deep
 * descendant can read the current user without re-invoking Tauri. */

interface AuthStore {
  user: UserInfo | null;
  setUser: (u: UserInfo | null) => void;
}

const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();

  // Hydrate the store on first mount; the route guard already verified a
  // session exists, so this only fills in the fields for UI consumption.
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    fetchCurrentUser().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, [user, setUser]);

  const login = async (email: string, password: string) => {
    const u = await performLogin(email, password);
    setUser(u);
    return u;
  };

  const logout = async () => {
    await performLogout();
    setUser(null);
    navigate({ to: "/login" });
  };

  return { user, login, logout, setUser };
}
