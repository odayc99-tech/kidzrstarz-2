import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.adminLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Logged in as admin");
      navigate("/admin");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    loginMutation.mutate({ secret: secret.trim() });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="max-w-sm w-full mx-4 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
              <ShieldAlert className="w-7 h-7 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-xl font-bold text-slate-900">
            Admin Access
          </CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            Enter the admin secret to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                placeholder="Admin secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoFocus
                className="pr-10"
                disabled={loginMutation.isPending}
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showSecret ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending || !secret.trim()}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
