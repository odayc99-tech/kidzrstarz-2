import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar, Step } from "@/components/ProgressBar";
import { Link, useSearch, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  RefreshCw,
  Sparkles,
  Pencil,
  Save,
  RotateCcw,
  X,
  Film,
  ThumbsUp,
  Lock,
  Unlock,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { getGuestToken, saveGuestToken } from "@/lib/guestToken";

const STEPS: Step[] = [
  { id: "upload", label: "Upload Photo" },
  { id: "details", label: "Child's Name" },
  { id: "story", label: "Review Story" },
  { id: "payment", label: "Payment" },
];

export default function CheckoutPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = useMemo(
    () => new URLSearchParams(searchString),
    [searchString]
  );
  const orderId = parseInt(searchParams.get("orderId") || "0");
  const paymentResult = searchParams.get("payment");

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [noRefundsAcknowledged, setNoRefundsAcknowledged] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [isEditingStory, setIsEditingStory] = useState(false);
  const [editedStory, setEditedStory] = useState("");
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentVerifyFailed, setPaymentVerifyFailed] = useState(false);
  const [savingStory, setSavingStory] = useState(false);
  const sessionId = searchParams.get("session_id");

  // Get guest token for this order: first from localStorage, then from URL params as fallback
  const urlGuestToken = searchParams.get("guestToken");
  const guestToken = useMemo(() => {
    if (orderId) {
      const stored = getGuestToken(orderId);
      if (stored) return stored;
      // Fallback: recover from URL param and save to localStorage
      if (urlGuestToken) {
        saveGuestToken(orderId, urlGuestToken);
        return urlGuestToken;
      }
    }
    return null;
  }, [orderId, urlGuestToken]);

  // Clean guestToken from URL after recovering it (keep URL clean)
  useEffect(() => {
    if (urlGuestToken && guestToken) {
      const params = new URLSearchParams(searchString);
      params.delete("guestToken");
      const cleanUrl = `/checkout?${params.toString()}`;
      window.history.replaceState(null, "", cleanUrl);
    }
  }, [urlGuestToken, guestToken, searchString]);

  // Determine if we can access this order
  const canAccess = isAuthenticated || !!guestToken;

  // Fetch order data (works for both auth and guest)
  const {
    data: order,
    isLoading: orderLoading,
    error: orderError,
    refetch,
  } = trpc.orders.getOrder.useQuery(
    { orderId, guestToken: guestToken || undefined },
    {
      enabled: !!orderId && canAccess,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return false;
        if (!data.previewImageUrl && data.status === "pending") return 3000;
        if (!data.story) return 3000;
        if (data.status === "processing") return 5000;
        if (data.paymentStatus === "paid" && data.status !== "completed" && data.status !== "failed") {
          return 5000;
        }
        return false;
      },
    }
  );

  // Verify Stripe session immediately when returning from Stripe (fallback for delayed webhooks)
  const verifySessionMutation = trpc.orders.verifyStripeSession.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        refetch();
        if (!data.alreadyPaid) {
          toast.success("Payment confirmed! Your storybook is being generated.");
        }
        setPaymentPending(false);
        setPaymentVerifyFailed(false);
      } else {
        // Session not paid yet — keep polling, webhook may still arrive
      }
    },
    onError: () => {
      // Session verification failed — keep polling, show retry after timeout
    },
  });

  // Show toast for payment result from Stripe redirect
  useEffect(() => {
    if (paymentResult === "success") {
      toast.success("Payment received! Processing your order...");
      setPaymentPending(true);
      const newParams = new URLSearchParams(searchString);
      newParams.delete("payment");
      newParams.delete("session_id");
      newParams.delete("from_webdev");
      setLocation(`/checkout?${newParams.toString()}`, { replace: true });

      // Immediately verify the Stripe session (don't wait for webhook)
      if (sessionId && orderId) {
        verifySessionMutation.mutate({
          orderId,
          sessionId,
          guestToken: guestToken || undefined,
        });
      }

      // Also poll as a secondary mechanism
      const pollInterval = setInterval(() => {
        refetch();
      }, 3000);
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        setPaymentPending(false);
        // If still not paid after 60s, show the failed state so user can retry
        if (order?.paymentStatus !== "paid") {
          setPaymentVerifyFailed(true);
        }
      }, 60000);
      return () => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
      };
    } else if (paymentResult === "cancelled") {
      toast.info("Payment was cancelled. You can try again when ready.");
      const newParams = new URLSearchParams(searchString);
      newParams.delete("payment");
      newParams.delete("session_id");
      setLocation(`/checkout?${newParams.toString()}`, { replace: true });
    }
  }, [paymentResult]);

  // Stop paymentPending once order is marked as paid
  useEffect(() => {
    if (order?.paymentStatus === "paid" && paymentPending) {
      setPaymentPending(false);
      toast.success("Payment confirmed! Your storybook is being generated.");
    }
  }, [order?.paymentStatus, paymentPending]);

  // Update story mutation
  const updateStoryMutation = trpc.orders.updateStory.useMutation({
    onSuccess: () => {
      toast.success("Story updated successfully!");
      setIsEditingStory(false);
      setSavingStory(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update story");
      setSavingStory(false);
    },
  });

  // Regenerate story mutation
  const regenerateStoryMutation = trpc.orders.regenerateStory.useMutation({
    onSuccess: () => {
      toast.info("Generating a new story... This may take a moment.");
      setIsEditingStory(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to regenerate story");
    },
  });

  // Approve story mutation
  const approveStoryMutation = trpc.orders.approveStory.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Story approved!");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to approve story");
    },
  });

  const handleSaveStory = () => {
    if (!editedStory.trim()) {
      toast.error("Story cannot be empty");
      return;
    }
    setSavingStory(true);
    updateStoryMutation.mutate({
      orderId,
      story: editedStory.trim(),
      guestToken: guestToken || undefined,
    });
  };

  const handleStartEditing = () => {
    setEditedStory(order?.story || "");
    setIsEditingStory(true);
  };

  const handleCancelEditing = () => {
    setIsEditingStory(false);
    setEditedStory("");
  };

  const handleRegenerateStory = () => {
    regenerateStoryMutation.mutate({
      orderId,
      guestToken: guestToken || undefined,
    });
  };

  const handleApproveStory = () => {
    approveStoryMutation.mutate({
      orderId,
      guestToken: guestToken || undefined,
    });
  };

  // Waiting for auth to resolve (brief)
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Not authenticated AND no guest token
  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Order Not Found
            </h2>
            <p className="text-slate-600 mb-6">
              We couldn't find this order. If you created it on another device, please sign in to access it.
            </p>
            <div className="space-y-3">
              <a href={getLoginUrl()}>
                <Button className="w-full bg-gradient-to-r from-blue-600 to-purple-600">
                  Sign In
                </Button>
              </a>
              <Link href="/upload">
                <Button variant="outline" className="w-full">
                  Create New Order
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No order ID
  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Invalid Order
            </h2>
            <p className="text-slate-600 mb-6">No order ID provided.</p>
            <Link href="/upload">
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600">
                Create New Order
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading order
  if (orderLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading your order...</p>
        </div>
      </div>
    );
  }

  // Order error
  if (orderError || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Order Not Found
            </h2>
            <p className="text-slate-600 mb-6">
              {orderError?.message || "Unable to load this order."}
            </p>
            <Link href="/upload">
              <Button variant="outline">Create New Order</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine current step based on story approval and payment
  let currentStep = 2; // Story review step
  const completedSteps = [0, 1];
  if (order.storyApproved) {
    completedSteps.push(2);
    currentStep = 3; // Payment step
  }
  if (order.paymentStatus === "paid") {
    completedSteps.push(2, 3);
    currentStep = 3;
  }

  const storyIsReady = order.story && order.story.trim() !== "";
  const canEdit = !order.storyApproved;
  const canApprove = storyIsReady && !order.storyApproved;
  const canPay = order.storyApproved && order.paymentStatus !== "paid";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="container flex items-center h-16 gap-4">
          {isAuthenticated ? (
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
          )}
          <h1 className="text-xl font-bold text-slate-900">
            Order #{orderId}
          </h1>
        </div>
      </div>

      {/* Optional Sign-In Banner for guests */}
      {!isAuthenticated && (
        <div className="bg-blue-50 border-b border-blue-100">
          <div className="container flex items-center justify-between py-2.5 gap-3">
            <p className="text-sm text-blue-700">
              <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="font-medium">Create an account</span> to save your orders and access them from any device.
            </p>
            <a href={getLoginUrl()}>
              <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100 whitespace-nowrap">
                Sign In / Sign Up
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* Progress */}
      <ProgressBar
        steps={STEPS}
        currentStep={currentStep}
        completedSteps={completedSteps}
      />

      <div className="container max-w-4xl pb-20">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Left: Images */}
          <div className="space-y-6">
            {/* Original Image */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Original Photo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-square rounded-lg overflow-hidden bg-slate-100">
                  <img
                    src={order.originalImageUrl ?? undefined}
                    alt="Original"
                    className="w-full h-full object-cover"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Preview Image */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Pixar Character Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {order.previewImageUrl ? (
                  <div className="aspect-square rounded-lg overflow-hidden bg-slate-100 relative">
                    <img
                      src={order.previewImageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    {order.paymentStatus !== "paid" && (
                      <div className="absolute inset-0 bg-black/10 flex items-end justify-center pb-4">
                        <span className="bg-white/90 px-4 py-2 rounded-full text-sm font-medium text-slate-700">
                          Low-res preview - Pay for full quality
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="aspect-square rounded-lg bg-slate-100 flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                      <p className="text-slate-600 text-sm">
                        Generating preview...
                      </p>
                      <p className="text-slate-400 text-xs mt-1">
                        This usually takes 1-3 minutes
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Order Details, Story Review, Payment */}
          <div className="space-y-6">
            {/* Order Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Order Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Child's Name</span>
                    <span className="font-medium">{order.childName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Product</span>
                    <span className="font-medium">Pixar Character</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Status</span>
                    <span
                      className={`font-medium capitalize ${
                        order.status === "completed"
                          ? "text-green-600"
                          : order.status === "processing"
                            ? "text-blue-600"
                            : order.status === "failed"
                              ? "text-red-600"
                              : "text-yellow-600"
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Story</span>
                    <span
                      className={`font-medium flex items-center gap-1 ${
                        order.storyApproved
                          ? "text-green-600"
                          : "text-yellow-600"
                      }`}
                    >
                      {order.storyApproved ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          Approved
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          Pending Review
                        </>
                      )}
                    </span>
                  </div>
                  <div className="border-t pt-3 flex justify-between">
                    <span className="text-lg font-bold">Total</span>
                    <span className="text-lg font-bold text-blue-700">
                      ${order.amount}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Story Review & Approval Section */}
            <Card className={order.storyApproved ? "border-green-200" : "border-purple-200"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    Personalized Story
                    {order.storyApproved && (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Approved
                      </span>
                    )}
                  </CardTitle>
                  {storyIsReady && canEdit && !isEditingStory && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleStartEditing}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Pencil className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRegenerateStory}
                        disabled={regenerateStoryMutation.isPending}
                        className="text-purple-600 hover:text-purple-700"
                      >
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Regenerate
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!storyIsReady ? (
                  <div className="flex items-center gap-3 py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                    <p className="text-slate-500 text-sm">
                      Generating your personalized story...
                    </p>
                  </div>
                ) : isEditingStory ? (
                  <div className="space-y-3">
                    <textarea
                      value={editedStory}
                      onChange={(e) => setEditedStory(e.target.value)}
                      className="w-full min-h-[200px] p-3 border border-slate-300 rounded-lg text-slate-700 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Edit your story here..."
                    />
                    <p className="text-xs text-slate-400">
                      You can edit details like hair color, setting, or any other story elements. The video will be generated based on this story.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEditing}
                        disabled={savingStory}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveStory}
                        disabled={savingStory}
                        className="bg-gradient-to-r from-blue-600 to-purple-600"
                      >
                        {savingStory ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-slate-700 leading-relaxed italic">
                      "{order.story}"
                    </p>

                    {/* Approval action area */}
                    {canApprove && (
                      <div className="mt-5 p-4 bg-purple-50 rounded-lg border border-purple-100">
                        <p className="text-sm text-purple-800 font-medium mb-1">
                          Happy with this story?
                        </p>
                        <p className="text-xs text-purple-600 mb-3">
                          Once approved, this story will be used to generate your animated storybook video. You can edit or regenerate it above before approving.
                        </p>
                        <Button
                          onClick={handleApproveStory}
                          disabled={approveStoryMutation.isPending}
                          className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                        >
                          {approveStoryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <ThumbsUp className="w-4 h-4 mr-2" />
                          )}
                          Approve Story
                        </Button>
                      </div>
                    )}

                    {order.storyApproved && order.paymentStatus !== "paid" && (
                      <p className="text-xs text-green-600 mt-3 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Story approved and locked. Proceed to payment below.
                      </p>
                    )}

                    {order.storyApproved && order.paymentStatus === "paid" && (
                      <p className="text-xs text-green-600 mt-3 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Story approved. Your animated storybook is being generated.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Section */}
            {order.paymentStatus === "paid" ? (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-green-800 mb-2">
                      Payment Complete!
                    </h3>

                    {order.status === "completed" && order.generatedImageUrl ? (
                      <>
                        <p className="text-green-700 mb-4">
                          Your Pixar character and animated storybook are ready!
                        </p>
                        <Link href={`/storybook?orderId=${orderId}${guestToken ? `&guestToken=${guestToken}` : ''}`}>
                          <Button className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                            <Film className="w-4 h-4 mr-2" />
                            Watch Animated Storybook
                          </Button>
                        </Link>
                      </>
                    ) : order.status === "failed" ? (
                      <>
                        <p className="text-red-700 mb-4">
                          There was an issue generating your image. Our team has
                          been notified.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => refetch()}
                          className="w-full"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Check Status
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-green-700 mb-4">
                          Your high-resolution image is being generated. This
                          usually takes 5-15 minutes.
                        </p>
                        <div className="flex items-center justify-center gap-2 text-green-600">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Processing...</span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : paymentVerifyFailed ? (
              <Card className="border-orange-200 bg-orange-50">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-orange-800 mb-2">
                      Payment Verification Delayed
                    </h3>
                    <p className="text-orange-700 mb-4">
                      Your payment may have been processed but we haven't received confirmation yet. Please check your email for a receipt from Stripe, then click below to retry.
                    </p>
                    <Button
                      onClick={() => { setPaymentVerifyFailed(false); refetch(); }}
                      className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Check Payment Status
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : paymentPending ? (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <Loader2 className="w-12 h-12 text-yellow-500 mx-auto mb-4 animate-spin" />
                    <h3 className="text-xl font-bold text-yellow-800 mb-2">
                      Confirming Payment...
                    </h3>
                    <p className="text-yellow-700 mb-4">
                      We're verifying your payment with Stripe. This usually takes just a few seconds.
                    </p>
                    <div className="flex items-center justify-center gap-2 text-yellow-600">
                      <span className="text-sm">Please wait...</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : canPay ? (
              <Card className="border-blue-200">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <CreditCard className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                      Complete Your Purchase
                    </h3>
                    <p className="text-slate-600 mb-6">
                      Your story is approved! Complete payment to get your high-resolution image and animated storybook.
                    </p>

                    {/* No Refunds Acknowledgment Checkbox */}
                    <label
                      className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all mb-6 text-left ${
                        noRefundsAcknowledged
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={noRefundsAcknowledged}
                        onChange={(e) => setNoRefundsAcknowledged(e.target.checked)}
                        className="mt-0.5 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                      />
                      <span className="text-sm text-slate-700 leading-relaxed">
                        I understand that <strong>all sales are final</strong>. I have reviewed my Pixar character preview and personalized story, and I confirm that I am satisfied with the results before proceeding to payment.
                      </span>
                    </label>

                    {/* Promo Code Input */}
                    <div className="mb-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Promo code (optional)"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <StripeCheckoutButton
                      orderId={orderId}
                      guestToken={guestToken}
                      loading={paymentLoading}
                      setLoading={setPaymentLoading}
                      disabled={!noRefundsAcknowledged}
                      promoCode={promoCode || undefined}
                    />

                    {!noRefundsAcknowledged && (
                      <p className="text-xs text-amber-600 mt-2 font-medium">
                        Please check the box above to confirm you've reviewed your order.
                      </p>
                    )}

                    <div className="mt-4 flex items-center justify-center gap-3 text-xs text-slate-500">
                      <span>Accepts:</span>
                      <div className="flex gap-2">
                        <span className="bg-slate-100 px-2 py-1 rounded font-medium">Credit Card</span>
                        <span className="bg-slate-100 px-2 py-1 rounded font-medium">Debit Card</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                      Secure payment powered by Stripe. All sales are final — no refunds.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : !order.storyApproved ? (
              <Card className="border-slate-200 bg-slate-50">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <Lock className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">
                      Payment Locked
                    </h3>
                    <p className="text-slate-500 text-sm">
                      Please review and approve your story above before proceeding to payment.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Stripe Checkout Button Component
 * Opens Stripe Checkout in a new tab for credit card and other payment methods
 */
function StripeCheckoutButton({
  orderId,
  guestToken,
  loading,
  setLoading,
  disabled = false,
  promoCode,
}: {
  orderId: number;
  guestToken: string | null;
  loading: boolean;
  setLoading: (v: boolean) => void;
  disabled?: boolean;
  promoCode?: string;
}) {
  const createCheckoutSession = trpc.orders.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to secure checkout...");
        window.location.href = data.checkoutUrl;
      } else {
        toast.error("Failed to create checkout session");
      }
      setLoading(false);
    },
    onError: (error) => {
      toast.error(error.message || "Payment failed. Please try again.");
      setLoading(false);
    },
  });

  const handlePayment = async () => {
    setLoading(true);
    try {
      await createCheckoutSession.mutateAsync({
        orderId,
        guestToken: guestToken || undefined,
        promoCode: promoCode || undefined,
        origin: window.location.origin,
      });
    } catch (error) {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handlePayment}
      disabled={loading || disabled}
      className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 py-6 text-lg"
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <CreditCard className="w-5 h-5 mr-2" />
          Pay $29.99
        </>
      )}
    </Button>
  );
}
