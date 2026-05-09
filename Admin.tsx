import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  Film,
  CheckCircle2,
  XCircle,
  Clock,
  CreditCard,
  Image as ImageIcon,
  Video,
  AlertTriangle,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo } from "react";

type FilterMode = "all" | "paid" | "video_failed" | "no_video" | "has_video";

export default function AdminPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const {
    data: allOrders,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = trpc.orders.adminGetAllOrders.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 10000,
  });

  const retryVideo = trpc.orders.adminRetryVideoGeneration.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.orders.adminGetAllOrders.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const backfillCompleted = trpc.orders.backfillCompletedOrders.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.orders.adminGetAllOrders.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
  const batchGenerate = trpc.orders.batchGenerateVideos.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch triggered: ${data.triggered} of ${data.totalFound} orders`);
      utils.orders.adminGetAllOrders.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // Compute filtered orders and stats — must be before any early returns to preserve hook order
  const filteredOrders = useMemo(() => {
    if (!allOrders) return [];
    switch (filter) {
      case "paid":
        return allOrders.filter((o) => o.paymentStatus === "paid");
      case "video_failed":
        return allOrders.filter(
          (o) =>
            o.paymentStatus === "paid" &&
            o.errorMessage &&
            o.errorMessage.includes("Video generation failed")
        );
      case "no_video":
        return allOrders.filter(
          (o) =>
            o.paymentStatus === "paid" &&
            o.storyApproved &&
            !o.videoUrl &&
            !(o.errorMessage && o.errorMessage.includes("Video generation failed"))
        );
      case "has_video":
        return allOrders.filter((o) => !!o.videoUrl);
      default:
        return allOrders;
    }
  }, [allOrders, filter]);

  const stats = useMemo(() => {
    if (!allOrders) return { total: 0, paid: 0, withVideo: 0, failed: 0, pending: 0, generating: 0 };
    const paid = allOrders.filter((o) => o.paymentStatus === "paid");
    const withVideo = allOrders.filter((o) => !!o.videoUrl);
    const failed = allOrders.filter(
      (o) => o.errorMessage && o.errorMessage.includes("Video generation failed")
    );
    const generating = allOrders.filter((o) => o.videoGenerating);
    const pending = paid.filter(
      (o) =>
        o.storyApproved &&
        !o.videoUrl &&
        !o.videoGenerating &&
        !(o.errorMessage && o.errorMessage.includes("Video generation failed"))
    );
    return {
      total: allOrders.length,
      paid: paid.length,
      withVideo: withVideo.length,
      failed: failed.length,
      pending: pending.length,
      generating: generating.length,
    };
  }, [allOrders]);

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Not admin — redirect to login
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <ShieldAlert className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Admin Login Required
            </h2>
            <p className="text-slate-600 mb-6">
              Please sign in with your admin secret to access this page.
            </p>
            <Link href="/admin-login">
              <Button className="w-full mb-3">Sign In as Admin</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getVideoStatus = (order: NonNullable<typeof allOrders>[0]) => {
    if (order.videoUrl) return { label: "Complete", color: "bg-green-100 text-green-800", icon: CheckCircle2 };
    if (order.videoGenerating) return { label: "Generating", color: "bg-blue-100 text-blue-800", icon: Loader2 };
    if (order.errorMessage && order.errorMessage.includes("Video generation failed"))
      return { label: "Failed", color: "bg-red-100 text-red-800", icon: XCircle };
    if (order.paymentStatus === "paid" && order.storyApproved)
      return { label: "Pending", color: "bg-yellow-100 text-yellow-800", icon: Clock };
    return { label: "N/A", color: "bg-slate-100 text-slate-600", icon: Clock };
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </Link>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-blue-600" />
              Admin Panel
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchOrders()}
              disabled={ordersLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${ordersLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => batchGenerate.mutate()}
              disabled={batchGenerate.isPending}
            >
              {batchGenerate.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Film className="w-4 h-4 mr-1" />
              )}
              Batch Generate Videos
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-green-300 text-green-700 hover:bg-green-50"
              onClick={() => backfillCompleted.mutate()}
              disabled={backfillCompleted.isPending}
              title="Fix orders that have a video but are stuck at processing/pending status"
            >
              {backfillCompleted.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-1" />
              )}
              Fix Stuck Orders
            </Button>
          </div>
        </div>
      </div>

      <div className="container max-w-7xl py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard
            label="Total Orders"
            value={stats.total}
            icon={<CreditCard className="w-5 h-5 text-slate-500" />}
            onClick={() => setFilter("all")}
            active={filter === "all"}
          />
          <StatCard
            label="Paid"
            value={stats.paid}
            icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
            onClick={() => setFilter("paid")}
            active={filter === "paid"}
          />
          <StatCard
            label="With Video"
            value={stats.withVideo}
            icon={<Video className="w-5 h-5 text-blue-500" />}
            onClick={() => setFilter("has_video")}
            active={filter === "has_video"}
          />
          <StatCard
            label="Generating"
            value={stats.generating}
            icon={<Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
          />
          <StatCard
            label="Pending"
            value={stats.pending}
            icon={<Clock className="w-5 h-5 text-yellow-500" />}
            onClick={() => setFilter("no_video")}
            active={filter === "no_video"}
          />
          <StatCard
            label="Failed"
            value={stats.failed}
            icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
            onClick={() => setFilter("video_failed")}
            active={filter === "video_failed"}
            highlight={stats.failed > 0}
          />
        </div>

        {/* Orders Table */}
        {ordersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : ordersError ? (
          <Card>
            <CardContent className="pt-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-slate-600">Failed to load orders: {ordersError.message}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Order</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Child</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Payment</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Story</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Image</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Video</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-500">
                        No orders match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const videoStatus = getVideoStatus(order);
                      const VideoIcon = videoStatus.icon;
                      const isExpanded = expandedOrder === order.id;

                      return (
                        <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs text-slate-500">#{order.id}</div>
                            <div className="text-xs text-slate-400">
                              {new Date(order.createdAt).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {(order.generatedImageUrl || order.previewImageUrl || order.originalImageUrl) && (
                                <img
                                  src={order.generatedImageUrl || order.previewImageUrl || order.originalImageUrl}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                />
                              )}
                              <div>
                                <div className="font-medium text-slate-900 text-sm">
                                  {order.childName || "—"}
                                </div>
                                <div className="text-xs text-slate-400 truncate max-w-[120px]">
                                  {order.storyTheme || "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                order.paymentStatus === "paid"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {order.paymentStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {order.storyApproved ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : order.story ? (
                              <Clock className="w-4 h-4 text-yellow-500" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {order.generatedImageUrl ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : order.previewImageUrl ? (
                              <ImageIcon className="w-4 h-4 text-yellow-500" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <VideoIcon
                                className={`w-4 h-4 ${
                                  videoStatus.label === "Generating" ? "animate-spin" : ""
                                }`}
                              />
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${videoStatus.color}`}
                              >
                                {videoStatus.label}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {/* Retry button for failed or pending video */}
                              {order.paymentStatus === "paid" &&
                                !order.videoUrl &&
                                !order.videoGenerating && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className={`h-7 text-xs ${
                                      order.errorMessage &&
                                      order.errorMessage.includes("Video generation failed")
                                        ? "border-red-300 text-red-700 hover:bg-red-50"
                                        : "border-blue-300 text-blue-700 hover:bg-blue-50"
                                    }`}
                                    onClick={() => retryVideo.mutate({ orderId: order.id })}
                                    disabled={retryVideo.isPending}
                                  >
                                    {retryVideo.isPending ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <>
                                        <RefreshCw className="w-3 h-3 mr-1" />
                                        Retry
                                      </>
                                    )}
                                  </Button>
                                )}

                              {/* View storybook */}
                              <Link href={`/storybook?orderId=${order.id}`}>
                                <Button variant="ghost" size="sm" className="h-7 text-xs">
                                  <Eye className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                              </Link>

                              {/* Expand error details */}
                              {order.errorMessage && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() =>
                                    setExpandedOrder(isExpanded ? null : order.id)
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="w-3 h-3" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3" />
                                  )}
                                </Button>
                              )}
                            </div>

                            {/* Expanded error message */}
                            {isExpanded && order.errorMessage && (
                              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 max-w-xs break-words">
                                {order.errorMessage}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  onClick,
  active,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer transition-all ${
        active
          ? "ring-2 ring-blue-500 bg-blue-50"
          : highlight
          ? "ring-1 ring-red-300 bg-red-50/50"
          : "hover:shadow-md"
      }`}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between mb-1">
          {icon}
          <span className="text-2xl font-bold text-slate-900">{value}</span>
        </div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
      </CardContent>
    </Card>
  );
}
