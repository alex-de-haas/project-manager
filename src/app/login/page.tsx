"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadBootstrapState = async () => {
      try {
        const response = await fetch("/api/auth/bootstrap");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (!cancelled) setRequiresSetup(false);
          return;
        }
        if (!cancelled) {
          setRequiresSetup(Boolean(data.requiresSetup));
        }
      } catch {
        if (!cancelled) setRequiresSetup(false);
      }
    };

    loadBootstrapState();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Failed to sign in");
        return;
      }

      const nextPath = searchParams.get("next");
      router.replace(nextPath || "/");
      router.refresh();
    } catch {
      setError("Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Failed to complete initial setup");
        return;
      }

      const nextPath = searchParams.get("next");
      router.replace(nextPath || "/");
      router.refresh();
    } catch {
      setError("Failed to complete initial setup");
    } finally {
      setSubmitting(false);
    }
  };

  if (requiresSetup === null) {
    return <div className="flex min-h-dvh items-center justify-center px-6">Loading...</div>;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{requiresSetup ? "Create first user" : "Sign in"}</CardTitle>
          <CardDescription>
            {requiresSetup
              ? "No users exist yet. Create the first user account to start using Project Manager."
              : "Use your email and password to access Project Manager."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={requiresSetup ? handleBootstrap : handleSignIn} className="space-y-4">
            {requiresSetup ? (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {requiresSetup ? (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? requiresSetup
                  ? "Creating user..."
                  : "Signing in..."
                : requiresSetup
                  ? "Create first user"
                  : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center px-6">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
