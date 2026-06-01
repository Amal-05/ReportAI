"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  configured: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isFirebaseConfigured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    return onAuthStateChanged(getFirebaseAuth(), async (nextUser) => {
      if (nextUser) {
        try {
          const token = await nextUser.getIdToken();
          localStorage.setItem("reportai_token", token);
        } catch (error) {
          console.error("Error getting ID token:", error);
        }
      } else {
        localStorage.removeItem("reportai_token");
      }
      setUser(nextUser);
      setLoading(false);
    });
  }, [configured]);

  const value = useMemo(() => ({ user, loading, configured }), [user, loading, configured]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
