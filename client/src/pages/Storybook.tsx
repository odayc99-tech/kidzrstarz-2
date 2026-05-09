import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useSearch } from "wouter";
import { getLoginUrl } from "@/const";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Film,
  RefreshCw,
  Sparkles,
  Share2,
  Check,
  UserPlus,
  RotateCcw,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { StoryPlayer } from "@/components/StoryPlayer";
import { StorybookSkeleton } from "@/components/StorybookSkeleton";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { getGuestToken, saveGuestToken } from "@/lib/guestToken";



export default function StorybookPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const orderId = parseInt(params.get("orderId") || "0");
  const [justCopied, setJustCopied] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [videoGenTriggered, setVideoGenTriggered] = useState(false);
  const videoGenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get guest token for this order: first from localStorage, then from URL params as fallback
  const urlGuestToken = params.get("guestToken");
  const guestToken = useMemo(() => {
    if (orderId) {
      const stored = getGuestToken(orderId);
      if (stored) return stored;
      if (urlGuestToken) {
        saveGuestToken(orderId, urlGuestToken);
        return urlGuestToken;
      }
    }
    return null;
  }, [orderId, urlGuestToken]);

  const canAccess = isAuthenticated || !!guestToken;

  const {
    data: order,
    isLoading: orderLoading,
    error: orderError,
    refetch: refetchOrder,
  } = trpc.orders.getOrder.useQuery(
    { orderId, guestToken: guestToken || undefined },
    { enabled: canAccess && orderId > 0, refetchInterval: 5000 }
  );

  const {
    data: scenes,
    isLoading: scenesLoading,
    refetch: refetchScenes,
  } = trpc.orders.getScenes.useQuery(
    { orderId, guestToken: guestToken || undefined },
    { enabled: canAccess && orderId > 0, refetchInterval: 5000 }
  );

  const triggerVideo = trpc.orders.triggerVideoGeneration.useMutation({
    onSuccess: () => {
      setVideoGenTriggered(true);
      toast.success("Video generation started! This may take 1-2 minutes. The page will update automatically.");
      refetchScenes();
      refetchOrder();
      // Auto-reset the local generating flag after 3 minutes as a safety net
      // If the server job completes, the videoUrl will appear and hasServerVideo will be true
      // If the server job fails, errorMessage will be set and we reset below
      if (videoGenTimeoutRef.current) clearTimeout(videoGenTimeoutRef.current);
      videoGenTimeoutRef.current = setTimeout(() => {
        setVideoGenTriggered(false);
      }, 180000); // 3 minutes
    },
    onError: (err) => {
      setVideoGenTriggered(false);
      toast.error(err.message);
    },
  });

  // Reset videoGenTriggered when video appears or error is reported
  useEffect(() => {
    if (order?.videoUrl || (order?.errorMessage && order.errorMessage.includes("Video generation failed"))) {
      setVideoGenTriggered(false);
      if (videoGenTimeoutRef.current) {
        clearTimeout(videoGenTimeoutRef.current);
        videoGenTimeoutRef.current = null;
      }
    }
  }, [order?.videoUrl, order?.errorMessage]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (videoGenTimeoutRef.current) clearTimeout(videoGenTimeoutRef.current);
    };
  }, []);

  const getVideoDownloadUrl = trpc.orders.getVideoDownloadUrl.useMutation({
    onSuccess: (data) => {
      // Use window.location.href to navigate to the pre-signed S3 URL.
      // The Content-Disposition: attachment header on the S3 response forces a file
      // download without leaving the page. This is more reliable than window.open()
      // in async callbacks because popup blockers don't apply to location.href.
      window.location.href = data.downloadUrl;
    },
    onError: (err) => {
      toast.error(`Download failed: ${err.message}`);
    },
  });

  const handleDownload = useCallback(() => {
    getVideoDownloadUrl.mutate({
      orderId,
      guestToken: guestToken || undefined,
    });
  }, [orderId, guestToken]);

  const regenerateStorybook = trpc.orders.regenerateStorybookStory.useMutation({
    onSuccess: () => {
      toast.success("Storybook regeneration started! A new story and scenes will be generated.");
      setShowRegenConfirm(false);
      refetchOrder();
      refetchScenes();
    },
    onError: (err) => {
      toast.error(err.message);
      setShowRegenConfirm(false);
    },
  });

  // Share link is only available for logged-in users
  const generateShareLink = trpc.orders.generateShareLink.useMutation({
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        toast.success("Share link copied to clipboard!");
      }).catch(() => {
        toast.success(`Share link: ${fullUrl}`);
      });
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2000);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleShare = () => {
    if (orderId > 0) {
      generateShareLink.mutate({ orderId });
    }
  };


  // Trigger server-side video generation
  const handleGenerateVideo = useCallback(() => {
    if (!order) return;
    triggerVideo.mutate({
      orderId,
      guestToken: guestToken || undefined,
    });
  }, [order, orderId, guestToken]);

  const handleRegenerate = () => {
    if (showRegenConfirm) {
      regenerateStorybook.mutate({
        orderId,
        guestToken: guestToken || undefined,
      });
    } else {
      setShowRegenConfirm(true);
    }
  };

  // Auth loading (brief)
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  // Not authenticated AND no guest token
  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Card className="max-w-md w-full mx-4 bg-slate-800 border-slate-700">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">
              Storybook Not Found
            </h2>
            <p className="text-slate-400 mb-6">
              We couldn't find this storybook. If you created it on another device, please sign in to access it.
            </p>
            <div className="space-y-3">
              <a href={getLoginUrl()}>
                <Button className="w-full bg-gradient-to-r from-purple-600 to-pink-600">
                  Sign In
                </Button>
              </a>
              <Link href="/upload">
                <Button variant="outline" className="w-full border-slate-600 text-slate-300">
                  Create New Story
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Card className="max-w-md w-full mx-4 bg-slate-800 border-slate-700">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">
              Invalid Order
            </h2>
            <p className="text-slate-400 mb-6">No order ID provided.</p>
            <Link href={isAuthenticated ? "/dashboard" : "/"}>
              <Button variant="outline" className="border-slate-600 text-slate-300">
                {isAuthenticated ? "Go to Dashboard" : "Go Home"}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allScenesCompleted =
    scenes && scenes.length > 0 && scenes.every((s) => s.status === "completed");
  const hasScenes = scenes && scenes.length > 0;
  const completedSceneCount = scenes?.filter(
    (s) => s.status === "completed" && s.illustrationUrl
  ).length || 0;

  // Determine video state
  const hasServerVideo = !!order?.videoUrl;
  // Only show error when there is NO video — if video succeeded after a previous failure, suppress the old error
  const hasVideoError = !hasServerVideo && !!(order?.errorMessage && order.errorMessage.includes("Video generation failed"));
  // Video is generating if: server reports it in progress, OR user just clicked the button
  // BUT NOT if: video error exists, video already exists, OR order is completed (status=completed means done)
  const isOrderComplete = order?.status === "completed";
  const videoGenerating = !hasServerVideo && !hasVideoError && !isOrderComplete && (order?.videoGenerating || videoGenTriggered || triggerVideo.isPending);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={isAuthenticated ? "/dashboard" : "/"}>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-1" />
              {isAuthenticated ? "Dashboard" : "Home"}
            </Button>
          </Link>
          <h1 className="text-lg font-bold text-white truncate mx-4">
            {order?.childName ? `${order.childName}'s Storybook` : "Animated Storybook"}
          </h1>
          <div className="flex items-center gap-2">
            {isAuthenticated && order?.paymentStatus === "paid" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShare}
                disabled={generateShareLink.isPending}
                className="text-slate-400 hover:text-white"
              >
                {justCopied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : generateShareLink.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Loading state — full skeleton */}
        {(orderLoading || scenesLoading) && !order && (
          <div className="-mx-4 -mt-8">
            <StorybookSkeleton />
          </div>
        )}

        {/* Error state */}
        {orderError && (
          <Card className="bg-slate-800 border-red-500/50 max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <p className="text-red-400 mb-4">
                Failed to load order. Please try again.
              </p>
              <Button onClick={() => refetchOrder()} variant="outline" className="border-slate-600 text-slate-300">
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        {order && !orderError && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Unpaid notice */}
            {order.paymentStatus !== "paid" && (
              <Card className="bg-amber-900/30 border-amber-500/50">
                <CardContent className="pt-6 text-center">
                  <p className="text-amber-300 mb-4">
                    Complete payment to unlock your full storybook video with narration and music.
                  </p>
                  <Link href={`/upload?orderId=${orderId}${guestToken ? `&guestToken=${guestToken}` : ""}`}>
                    <Button className="bg-gradient-to-r from-amber-500 to-orange-500 text-white">
                      Complete Payment
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Generation progress */}
            {order.paymentStatus === "paid" && !allScenesCompleted && hasScenes && (
              <Card className="bg-slate-800/50 border-purple-500/30">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <h3 className="text-lg font-bold text-white">
                      Generating Your Storybook...
                    </h3>
                  </div>
                  <p className="text-slate-400 text-sm mb-3">
                    {completedSceneCount} of {scenes?.length || 0} scenes completed. This page updates automatically.
                  </p>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${scenes?.length ? (completedSceneCount / scenes.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trigger video generation for paid orders with no scenes yet */}
            {order.paymentStatus === "paid" && order.storyApproved && !hasScenes && !hasServerVideo && (
              <Card className="bg-slate-800/50 border-purple-500/30">
                <CardContent className="pt-6 text-center">
                  {videoGenerating ? (
                    <>
                      <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-3" />
                      <h3 className="text-lg font-bold text-white mb-2">
                        Generating Your Storybook...
                      </h3>
                      <p className="text-slate-400 mb-4">
                        This may take 1-2 minutes. The page will update automatically when ready.
                      </p>
                    </>
                  ) : (
                    <>
                      <Film className="w-10 h-10 text-purple-400 mx-auto mb-3" />
                      <h3 className="text-lg font-bold text-white mb-2">
                        Ready to Create Your Storybook
                      </h3>
                      <p className="text-slate-400 mb-4">
                        Your story is approved and payment is complete. Generate your animated storybook video!
                      </p>
                      <Button
                        onClick={handleGenerateVideo}
                        disabled={triggerVideo.isPending}
                        className="bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                      >
                        <Film className="w-5 h-5 mr-2" />
                        Generate Storybook Video
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Story Player */}
            <StoryPlayer
              scenes={scenes || []}
              childName={order?.childName || "Child"}
              storyTheme={order?.storyTheme}
              isLoading={false}
            />

            {/* Video Player - show when video is ready */}
            {hasServerVideo && order?.videoUrl && (
              <Card className="bg-gradient-to-r from-purple-900/60 to-pink-900/60 border-purple-500/40">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Film className="w-5 h-5 text-purple-400" />
                    Your Animated Storybook Video
                  </h3>
                  <div className="rounded-xl overflow-hidden bg-black">
                    <video
                      src={order.videoUrl}
                      controls
                      autoPlay={false}
                      className="w-full max-h-[480px]"
                      playsInline
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <div className="mt-4 flex gap-3 justify-center">
                    <Button
                      onClick={handleDownload}
                      disabled={getVideoDownloadUrl.isPending}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-5 py-2.5 font-semibold"
                    >
                      {getVideoDownloadUrl.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      {getVideoDownloadUrl.isPending ? "Preparing Download..." : "Download Video"}
                    </Button>
                  </div>
                  <p className="text-xs text-purple-300/60 mt-3 text-center">
                    Your personalized animated storybook is ready! Download or share it with family.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Completed order with no video URL — show retry button */}
            {isOrderComplete && !hasServerVideo && (
              <Card className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-purple-500/30">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Film className="w-5 h-5 text-purple-400" />
                    Storybook Video
                  </h3>
                  <p className="text-sm text-purple-300/80 mb-4">Your storybook is complete! If the video isn't loading, click below to reload it.</p>
                  <Button
                    onClick={() => refetchOrder()}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reload Video
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Video Generation Section - for paid orders with all scenes complete (not yet completed) */}
            {order?.paymentStatus === "paid" && allScenesCompleted && !hasServerVideo && !isOrderComplete && (
              <Card className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-purple-500/30">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Film className="w-5 h-5 text-purple-400" />
                    Storybook Video
                  </h3>
                  {videoGenerating ? (
                    <div className="w-full bg-gradient-to-r from-pink-900/50 to-pink-800/50 border border-pink-500/30 rounded-lg py-3 px-4 flex items-center">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin flex-shrink-0 text-pink-400" />
                      <div className="text-left">
                        <div className="font-semibold text-white">Generating Video...</div>
                        <div className="text-xs text-pink-300/75">This may take 1-2 minutes. Page updates automatically.</div>
                      </div>
                    </div>
                  ) : order?.errorMessage && order.errorMessage.includes("Video generation failed") ? (
                    <div>
                      <div className="bg-red-900/30 border border-red-500/30 rounded-lg py-3 px-4 mb-2">
                        <div className="flex items-center gap-2 text-red-300 mb-1">
                          <AlertCircle className="w-4 h-4" />
                          <span className="font-semibold text-sm">Video Generation Failed</span>
                        </div>
                        <p className="text-xs text-red-300/75">There was an issue generating your video. Please try again.</p>
                      </div>
                      <Button
                        onClick={handleGenerateVideo}
                        disabled={triggerVideo.isPending}
                        className="w-full bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white h-auto py-3"
                      >
                        <RefreshCw className="w-5 h-5 mr-2 flex-shrink-0" />
                        <div className="text-left">
                          <div className="font-semibold">Retry Video Generation</div>
                          <div className="text-xs opacity-75">Try creating your MP4 again</div>
                        </div>
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleGenerateVideo}
                      disabled={triggerVideo.isPending}
                      className="w-full bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white h-auto py-3"
                    >
                      <Film className="w-5 h-5 mr-2 flex-shrink-0" />
                      <div className="text-left">
                        <div className="font-semibold">Generate Storybook Video</div>
                        <div className="text-xs opacity-75">Create MP4 with narration & music</div>
                      </div>
                    </Button>
                  )}
                  <p className="text-xs text-purple-300/60 mt-3 text-center">
                    {allScenesCompleted
                      ? "Click 'Generate Storybook Video' to create your animated MP4 with narration and music."
                      : "Video generation will be available once all scenes are generated."}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Regenerate Story Section - for paid orders */}
            {order?.paymentStatus === "paid" && allScenesCompleted && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 text-amber-400" />
                        Want a Different Story?
                      </h3>
                      <p className="text-sm text-slate-400 mt-1">
                        Regenerate with a brand new story and fresh scene illustrations.
                      </p>
                    </div>
                    {showRegenConfirm ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowRegenConfirm(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleRegenerate}
                          disabled={regenerateStorybook.isPending}
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          {regenerateStorybook.isPending ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : null}
                          Yes, Regenerate
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRegenerate}
                        className="border-amber-500/50 text-amber-400 hover:bg-amber-900/30 flex-shrink-0"
                      >
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Regenerate Story
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Story text below player */}
            {order?.story && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-400" />
                    Full Story
                  </h3>
                  <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {order.story}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Generated character image */}
            {order?.generatedImageUrl && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-white">
                      Character Image
                    </h3>

                  </div>
                  <div className="rounded-xl overflow-hidden max-w-sm mx-auto">
                    <img
                      src={order.generatedImageUrl}
                      alt={`${order.childName}'s Pixar character`}
                      className="w-full"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
