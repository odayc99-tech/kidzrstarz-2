import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Film,
  RefreshCw,
  Sparkles,
  Share2,
  Check,
  Download,
  Image as ImageIcon,
  UserPlus,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { StoryPlayer } from "@/components/StoryPlayer";
import { useState, useCallback, useMemo } from "react";
import { getGuestToken, saveGuestToken } from "@/lib/guestToken";
import { composeVideoInBrowser } from "@/lib/videoComposer";
import { THEME_BGM, DEFAULT_BGM_VOLUME } from "@/data/themeBgm";

/**
 * Download a file using the server-side proxy to bypass CORS issues.
 * Falls back to direct URL if proxy fails.
 */
async function downloadFile(url: string, filename: string, proxyUrl?: string) {
  const downloadUrl = proxyUrl || url;
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: try direct link, then open in new tab
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.open(url, "_blank");
    }
  }
}

export default function StorybookPage() {
  const { user, isAuthenticated, loading: authLoading, openSignIn } = useAuth();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const orderId = parseInt(params.get("orderId") || "0");
  const [justCopied, setJustCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStatus, setVideoStatus] = useState("");
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

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
      toast.success("Video generation started! Scenes will appear shortly.");
      refetchScenes();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

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

  const handleDownloadCharacter = useCallback(async () => {
    if (!order?.generatedImageUrl) return;
    setDownloading("character");
    const childName = order.childName || "character";
    const safeName = childName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const proxyUrl = `/api/download/${orderId}/character`;
    await downloadFile(order.generatedImageUrl, `${safeName}_animated_character.png`, proxyUrl);
    toast.success("Character image downloaded!");
    setDownloading(null);
  }, [order, orderId]);

  const getVideoDownloadUrl = trpc.orders.getVideoDownloadUrl.useMutation();

  const handleDownloadVideo = useCallback(async () => {
    if (!orderId) return;
    setDownloading("video");
    setVideoProgress(0);
    setVideoStatus("Preparing download...");
    try {
      // Prefer server-generated MP4 (already composed with narration + BGM)
      if (order?.videoUrl) {
        setVideoStatus("Getting download link...");
        const { downloadUrl, filename } = await getVideoDownloadUrl.mutateAsync({
          orderId,
          guestToken: guestToken || undefined,
        });
        setVideoStatus("Downloading MP4...");
        await downloadFile(downloadUrl, filename);
        toast.success("Storybook video downloaded!");
        return;
      }

      // Fallback: client-side composition if server video not ready yet
      if (!scenes || scenes.length === 0) {
        toast.error("No scenes available to download.");
        return;
      }
      const completedScenes = scenes.filter(
        (s) => s.status === "completed" && s.illustrationUrl
      );
      if (completedScenes.length === 0) {
        toast.error("No completed scenes to download.");
        return;
      }
      const theme = order?.storyTheme || "adventure";
      const bgmConfig = THEME_BGM[theme] || THEME_BGM.adventure;
      const videoBlob = await composeVideoInBrowser({
        scenes: completedScenes.map((s) => ({
          illustrationUrl: s.illustrationUrl!,
          narrationUrl: s.narrationUrl,
          sceneText: s.sceneText,
        })),
        bgmUrl: bgmConfig.url,
        bgmVolume: DEFAULT_BGM_VOLUME,
        onProgress: (progress, status) => {
          setVideoProgress(Math.round(progress));
          setVideoStatus(status);
        },
      });
      const childName = order?.childName || "storybook";
      const safeName = childName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const blobUrl = URL.createObjectURL(videoBlob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${safeName}_storybook.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success("Storybook video downloaded!");
    } catch (err: any) {
      console.error("Video download failed:", err);
      toast.error(`Video download failed: ${err.message || "Unknown error"}. Please try again.`);
    } finally {
      setDownloading(null);
      setVideoProgress(0);
      setVideoStatus("");
    }
  }, [scenes, order, orderId, guestToken, getVideoDownloadUrl]);

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
                              <Button className="w-full bg-gradient-to-r from-purple-600 to-pink-600" onClick={() => openSignIn()}>
                  Sign In
                </Button>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-md border-b border-white/10">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href={isAuthenticated ? "/dashboard" : "/"}>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {isAuthenticated ? "Dashboard" : "Home"}
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Film className="w-5 h-5 text-purple-400" />
              <h1 className="text-lg font-bold text-white">
                {order?.childName ? `${order.childName}'s Storybook` : "Animated Storybook"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Share button - only for logged-in users */}
            {isAuthenticated && order?.paymentStatus === "paid" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleShare}
                disabled={generateShareLink.isPending}
                className="text-white hover:bg-white/10"
              >
                {justCopied ? (
                  <>
                    <Check className="w-4 h-4 mr-1 text-green-400" />
                    <span className="text-green-400">Copied!</span>
                  </>
                ) : generateShareLink.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <>
                    <Share2 className="w-4 h-4 mr-1" />
                    Share
                  </>
                )}
              </Button>
            )}

            {order?.paymentStatus === "paid" && !hasScenes && (
              <Button
                size="sm"
                onClick={() => triggerVideo.mutate({ orderId, guestToken: guestToken || undefined })}
                disabled={triggerVideo.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600"
              >
                {triggerVideo.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-1" />
                )}
                Generate Storybook
              </Button>
            )}

            {hasScenes && !allScenesCompleted && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => refetchScenes()}
                className="text-white hover:bg-white/10"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Optional Sign-In Banner for guests */}
      {!isAuthenticated && (
        <div className="bg-purple-900/50 border-b border-purple-500/20">
          <div className="container flex items-center justify-between py-2.5 gap-3">
            <p className="text-sm text-purple-200">
              <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="font-medium">Create an account</span> to save your storybooks and share them with family.
            </p>
                          <Button variant="outline" size="sm" className="border-purple-400/50 text-purple-200 hover:bg-purple-800/50 whitespace-nowrap" onClick={() => openSignIn()}>
                Sign In / Sign Up
              </Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="container max-w-4xl py-8">
        {orderLoading || scenesLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          </div>
        ) : orderError ? (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-slate-400">
                Failed to load order. Please try again.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Story Player */}
            <StoryPlayer
              scenes={scenes || []}
              childName={order?.childName || "Child"}
              storyTheme={order?.storyTheme}
              isLoading={false}
            />

            {/* Download Section - only for paid orders with completed content */}
            {order?.paymentStatus === "paid" && (order?.generatedImageUrl || allScenesCompleted) && (
              <Card className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-purple-500/30">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Download className="w-5 h-5 text-purple-400" />
                    Download Your Content
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Download Character Image */}
                    {order.generatedImageUrl && (
                      <Button
                        onClick={handleDownloadCharacter}
                        disabled={downloading === "character"}
                        className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white h-auto py-3"
                      >
                        {downloading === "character" ? (
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                          <ImageIcon className="w-5 h-5 mr-2" />
                        )}
                        <div className="text-left">
                          <div className="font-semibold">Animated Character</div>
                          <div className="text-xs opacity-75">High-res PNG image</div>
                        </div>
                      </Button>
                    )}

                    {/* Create & Download Video (client-side composition) */}
                    {allScenesCompleted && (
                      <Button
                        onClick={handleDownloadVideo}
                        disabled={downloading === "video"}
                        className="w-full bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white h-auto py-3 relative overflow-hidden"
                      >
                        {downloading === "video" ? (
                          <>
                            {/* Progress bar background */}
                            <div
                              className="absolute inset-0 bg-pink-400/20 transition-all duration-300"
                              style={{ width: `${videoProgress}%` }}
                            />
                            <div className="relative flex items-center w-full">
                              <Loader2 className="w-5 h-5 mr-2 animate-spin flex-shrink-0" />
                              <div className="text-left min-w-0">
                                <div className="font-semibold">{videoProgress}% — Creating Video</div>
                                <div className="text-xs opacity-75 truncate">{videoStatus}</div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <Film className="w-5 h-5 mr-2" />
                            <div className="text-left">
                              <div className="font-semibold">Create & Download Video</div>
                              <div className="text-xs opacity-75">
                                {order?.videoUrl ? "MP4 with narration & music" : "Compose & download video"}
                              </div>
                            </div>
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-purple-300/60 mt-3 text-center">
                    {allScenesCompleted
                      ? "Create a full storybook video with narration and background music right in your browser, or download the high-res character image."
                      : "Download your high-res animated character image. Video creation will be available once all scenes are generated."}
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
                    {order.paymentStatus === "paid" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDownloadCharacter}
                        disabled={downloading === "character"}
                        className="text-purple-400 hover:text-purple-300 hover:bg-purple-900/30"
                      >
                        {downloading === "character" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl overflow-hidden max-w-sm mx-auto">
                    <img
                      src={order.generatedImageUrl}
                      alt={`${order.childName}'s animated character`}
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
