import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Image as ImageIcon,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  Eye,
  LogOut,
  Film,
  Share2,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function DashboardPage() {
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null);

  const {
    data: orders,
    isLoading: ordersLoading,
    error: ordersError,
  } = trpc.orders.getUserOrders.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const generateShareLink = trpc.orders.generateShareLink.useMutation({
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        toast.success("Share link copied to clipboard!");
      }).catch(() => {
        toast.success(`Share link: ${fullUrl}`);
      });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleShare = async (orderId: number) => {
    setCopiedOrderId(orderId);
    generateShareLink.mutate({ orderId });
    setTimeout(() => setCopiedOrderId(null), 2000);
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully");
    } catch {
      toast.error("Failed to log out");
    }
  };

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Sign In Required
            </h2>
            <p className="text-slate-600 mb-6">
              Please sign in to view your dashboard.
            </p>
            <a href={getLoginUrl()}>
              <Button className="w-full bg-gradient-to-r from-blue-600 to-purple-600">
                Sign In
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "processing":
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "processing":
        return "bg-blue-100 text-blue-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
            <h1 className="text-xl font-bold text-slate-900">My Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 hidden md:block">
              {user?.name || user?.email}
            </span>
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
                  <ShieldAlert className="w-4 h-4 mr-1" />
                  Admin
                </Button>
              </Link>
            )}
            <Link href="/upload">
              <Button
                size="sm"
                className="bg-gradient-to-r from-blue-600 to-purple-600"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Character
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="container max-w-5xl py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            Welcome back, {user?.name || "there"}!
          </h2>
          <p className="text-slate-600">
            View and manage your Pixar character transformations.
          </p>
        </div>

        {/* Orders */}
        {ordersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : ordersError ? (
          <Card>
            <CardContent className="pt-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-slate-600">
                Failed to load orders. Please try again.
              </p>
            </CardContent>
          </Card>
        ) : !orders || orders.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <ImageIcon className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                No Characters Yet
              </h3>
              <p className="text-slate-600 mb-6">
                Create your first Pixar character transformation!
              </p>
              <Link href="/upload">
                <Button className="bg-gradient-to-r from-blue-600 to-purple-600">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Character
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {orders.map((order) => (
              <Card
                key={order.id}
                className="overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Thumbnail */}
                  <div className="md:w-48 h-48 md:h-auto bg-slate-100 flex-shrink-0">
                    <img
                      src={
                        order.generatedImageUrl ||
                        order.previewImageUrl ||
                        order.originalImageUrl
                      }
                      alt={order.childName || "Character"}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-grow p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">
                          {order.childName}'s Pixar Character
                        </h3>
                        <p className="text-sm text-slate-500">
                          Order #{order.id} &middot;{" "}
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(order.status)}
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded-full capitalize ${getStatusColor(order.status)}`}
                        >
                          {order.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full capitalize ${
                          order.paymentStatus === "paid"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        <CreditCard className="w-3 h-3 inline mr-1" />
                        {order.paymentStatus}
                      </span>
                      <span className="text-sm font-medium text-slate-700">
                        ${order.amount}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3">
                      <Link href={`/checkout?orderId=${order.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          View Details
                        </Button>
                      </Link>

                      {order.status === "completed" &&
                        order.generatedImageUrl && (
                          <>
                            <Link href={`/storybook?orderId=${order.id}`}>
                              <Button
                                size="sm"
                                className="bg-gradient-to-r from-purple-600 to-pink-600"
                              >
                                <Film className="w-4 h-4 mr-1" />
                                Watch Storybook
                              </Button>
                            </Link>
                          </>
                        )}

                      {/* Share button for paid orders */}
                      {order.paymentStatus === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-purple-300 text-purple-700 hover:bg-purple-50"
                          onClick={() => handleShare(order.id)}
                          disabled={generateShareLink.isPending && copiedOrderId === order.id}
                        >
                          {copiedOrderId === order.id ? (
                            <>
                              <Check className="w-4 h-4 mr-1 text-green-600" />
                              Copied!
                            </>
                          ) : generateShareLink.isPending && copiedOrderId === order.id ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : (
                            <>
                              <Share2 className="w-4 h-4 mr-1" />
                              Share
                            </>
                          )}
                        </Button>
                      )}

                      {order.paymentStatus !== "paid" && (
                        <Link href={`/checkout?orderId=${order.id}`}>
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-blue-600 to-purple-600"
                          >
                            <CreditCard className="w-4 h-4 mr-1" />
                            Complete Payment
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
