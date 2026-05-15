import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { getAllGuestTokens, getGuestToken } from "@/lib/guestToken";
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
  Film,
  UserPlus,
} from "lucide-react";
import { useMemo } from "react";

export default function GuestOrdersPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // If authenticated, redirect to dashboard
  if (isAuthenticated && !authLoading) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  // Get all guest tokens from localStorage
  const guestTokenEntries = useMemo(() => getAllGuestTokens(), []);
  const guestTokens = useMemo(
    () => guestTokenEntries.map((t) => t.guestToken),
    [guestTokenEntries]
  );

  const {
    data: orders,
    isLoading: ordersLoading,
    error: ordersError,
  } = trpc.orders.getGuestOrders.useQuery(
    { guestTokens },
    { enabled: guestTokens.length > 0, refetchInterval: 10000 }
  );

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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

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
            <h1 className="text-xl font-bold text-slate-900">My Orders</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/upload">
              <Button
                size="sm"
                className="bg-gradient-to-r from-blue-600 to-purple-600"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Character
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Sign-in banner */}
      <div className="bg-purple-50 border-b border-purple-100">
        <div className="container flex items-center justify-between py-3 gap-3">
          <p className="text-sm text-purple-700">
            <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            <span className="font-medium">Create an account</span> to save your
            orders permanently and access them from any device.
          </p>
          <a href={getLoginUrl()}>
            <Button
              variant="outline"
              size="sm"
              className="border-purple-300 text-purple-700 hover:bg-purple-100 whitespace-nowrap"
            >
              Sign In / Sign Up
            </Button>
          </a>
        </div>
      </div>

      <div className="container max-w-5xl py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            Your Orders
          </h2>
          <p className="text-slate-600">
            Orders created on this device. Sign in to access them from anywhere.
          </p>
        </div>

        {/* No tokens at all */}
        {guestTokens.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <ImageIcon className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                No Orders Yet
              </h3>
              <p className="text-slate-600 mb-6">
                Create your first animated character storybook!
              </p>
              <Link href="/upload">
                <Button className="bg-gradient-to-r from-blue-600 to-purple-600">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Character
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : ordersLoading ? (
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
                No Orders Found
              </h3>
              <p className="text-slate-600 mb-6">
                Your previous orders may have been claimed by your account.
                Check your dashboard after signing in.
              </p>
              <div className="flex gap-3 justify-center">
                <a href={getLoginUrl()}>
                  <Button
                    variant="outline"
                    className="border-purple-300 text-purple-700"
                  >
                    Sign In
                  </Button>
                </a>
                <Link href="/upload">
                  <Button className="bg-gradient-to-r from-blue-600 to-purple-600">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Character
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {orders.map((order) => {
              const orderGuestToken = getGuestToken(order.id);
              return (
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
                            {order.childName}'s Animated Character
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
                            <Link href={`/storybook?orderId=${order.id}`}>
                              <Button
                                size="sm"
                                className="bg-gradient-to-r from-purple-600 to-pink-600"
                              >
                                <Film className="w-4 h-4 mr-1" />
                                Watch Storybook
                              </Button>
                            </Link>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
