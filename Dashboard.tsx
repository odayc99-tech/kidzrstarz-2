import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { getLoginUrl, LOGO_URL } from "@/const";
import NavBar from "@/components/NavBar";
import { BookOpen, CheckCircle, Clock, Loader2, Plus, Sparkles, Wand2, XCircle } from "lucide-react";
import { Link } from "wouter";

function StatusBadge({ status, paymentStatus }: { status: string; paymentStatus: string }) {
  if (paymentStatus !== "paid") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        <Clock className="w-3 h-3" />
        Awaiting Payment
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle className="w-3 h-3" />
        Ready
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Generating
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const { user, isAuthenticated, loading } = useAuth();
  const { data: orders, isLoading } = trpc.orders.getUserOrders.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
        <NavBar />
        <div className="container py-20 text-center max-w-md mx-auto">
          <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-10 h-10 text-purple-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3" style={{ fontFamily: "'Fredoka', sans-serif" }}>
            Sign In to View Dashboard
          </h1>
          <p className="text-slate-600 mb-6">Log in to see all your storybooks in one place</p>
          <a href={getLoginUrl()}>
            <Button className="bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold px-8 py-3 rounded-2xl">
              Sign In
            </Button>
          </a>
          <div className="mt-4">
            <Link href="/my-orders">
              <Button variant="ghost" className="text-purple-600 hover:text-purple-700">
                Or look up guest orders →
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
      <NavBar />

      <div className="container py-10 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900" style={{ fontFamily: "'Fredoka', sans-serif" }}>
              My Storybooks
            </h1>
            <p className="text-slate-600 mt-1">Welcome back, {user?.name || "there"}!</p>
          </div>
          <Link href="/upload">
            <Button className="bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 hover:from-purple-700 hover:via-pink-600 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-2xl shadow-lg">
              <Plus className="mr-2 w-4 h-4" />
              Create New
            </Button>
          </Link>
        </div>

        {/* Orders */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
          </div>
        ) : !orders || orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Sparkles className="w-10 h-10 text-purple-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3" style={{ fontFamily: "'Fredoka', sans-serif" }}>
              No Storybooks Yet
            </h2>
            <p className="text-slate-600 mb-6">Create your first personalized Pixar-style storybook!</p>
            <Link href="/upload">
              <Button className="bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold px-8 py-3 rounded-2xl">
                <Wand2 className="mr-2 w-4 h-4" />
                Create Your First Storybook
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {orders.map((order) => (
              <Card key={order.id} className="rounded-3xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border border-purple-100">
                {/* Image */}
                <div className="relative aspect-square bg-gradient-to-br from-purple-100 to-pink-100">
                  {order.generatedImageUrl ? (
                    <img
                      src={order.generatedImageUrl}
                      alt={`${order.childName}'s character`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-5xl mb-2">🎨</div>
                        <p className="text-slate-400 text-sm">Generating...</p>
                      </div>
                    </div>
                  )}
                  <div className="absolute top-3 right-3">
                    <StatusBadge status={order.status} paymentStatus={order.paymentStatus} />
                  </div>
                </div>

                <CardContent className="p-5">
                  <h3 className="font-bold text-slate-900 text-lg mb-1" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                    {order.childName}'s Story
                  </h3>
                  <p className="text-sm text-slate-500 capitalize mb-4">{order.storyTheme} theme</p>

                  <Link href={`/storybook?orderId=${order.id}`}>
                    <Button
                      variant={order.paymentStatus === "paid" ? "default" : "outline"}
                      size="sm"
                      className={`w-full rounded-xl ${
                        order.paymentStatus === "paid"
                          ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white"
                          : "border-purple-200 text-purple-700 hover:bg-purple-50"
                      }`}
                    >
                      <BookOpen className="mr-2 w-4 h-4" />
                      {order.paymentStatus === "paid" ? "View Storybook" : "Complete Purchase"}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
