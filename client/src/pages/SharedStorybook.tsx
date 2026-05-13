import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "wouter";
import {
  Loader2,
  AlertCircle,
  Film,
  Sparkles,
  Home,
} from "lucide-react";
import { StoryPlayer, Scene } from "@/components/StoryPlayer";

export default function SharedStorybookPage() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";

  const {
    data: storybook,
    isLoading,
    error,
  } = trpc.orders.getSharedStorybook.useQuery(
    { shareToken: token },
    { enabled: !!token, refetchInterval: 10000 }
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-white text-lg">Loading storybook...</p>
        </div>
      </div>
    );
  }

  // Error / not found
  if (error || !storybook) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Card className="max-w-md w-full mx-4 bg-slate-800 border-slate-700">
          <CardContent className="pt-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">
              Storybook Not Found
            </h2>
            <p className="text-slate-400 mb-6">
              This storybook link may have expired or been revoked by the owner.
            </p>
            <Link href="/">
              <Button className="bg-gradient-to-r from-purple-600 to-pink-600">
                <Home className="w-4 h-4 mr-2" />
                Go to Homepage
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Map scenes to the StoryPlayer format
  const playerScenes: Scene[] = storybook.scenes.map((s, i) => ({
    id: i,
    sceneIndex: s.sceneIndex,
    sceneText: s.sceneText,
    illustrationUrl: s.illustrationUrl,
    narrationUrl: s.narrationUrl,
    status: s.status,
  }));

  const completedScenes = playerScenes.filter(
    (s) => s.status === "completed" && s.illustrationUrl
  );
  const hasCompletedScenes = completedScenes.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-md border-b border-white/10">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Film className="w-5 h-5 text-purple-400" />
            <h1 className="text-lg font-bold text-white">
              {storybook.childName
                ? `${storybook.childName}'s Storybook`
                : "Animated Storybook"}
            </h1>
            {storybook.storyTheme && storybook.storyTheme !== "adventure" && (
              <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-0.5 rounded-full capitalize">
                {storybook.storyTheme.replace(/_/g, " ")}
              </span>
            )}
          </div>

          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Create Your Own
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="container max-w-4xl py-8">
        <div className="space-y-6">
          {/* Story Player */}
          {hasCompletedScenes ? (
            <StoryPlayer
              scenes={playerScenes}
              childName={storybook.childName || "Child"}
              storyTheme={storybook.storyTheme}
              isLoading={false}
            />
          ) : (
            <div className="bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
              <div className="text-center text-white px-6">
                <Film className="w-12 h-12 mx-auto mb-4 text-purple-400" />
                <p className="text-lg font-medium">Storybook is being created</p>
                <p className="text-sm text-slate-400 mt-2">
                  The scenes are still being generated. Check back soon!
                </p>
                {storybook.scenes.length > 0 && (
                  <div className="flex gap-2 justify-center mt-4">
                    {storybook.scenes.map((s, i) => (
                      <div
                        key={i}
                        className={`w-3 h-3 rounded-full ${
                          s.status === "completed"
                            ? "bg-green-400"
                            : s.status === "failed"
                              ? "bg-red-400"
                              : "bg-slate-600 animate-pulse"
                        }`}
                        title={`Scene ${i + 1}: ${s.status}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Story text */}
          {storybook.story && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  {storybook.childName
                    ? `${storybook.childName}'s Story`
                    : "The Story"}
                </h3>
                <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {storybook.story}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Character image */}
          {storybook.generatedImageUrl && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <h3 className="text-lg font-bold text-white mb-3">
                  Character Image
                </h3>
                <div className="rounded-xl overflow-hidden max-w-sm mx-auto">
                  <img
                    src={storybook.generatedImageUrl}
                    alt={`${storybook.childName}'s Pixar character`}
                    className="w-full"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* CTA */}
          <div className="text-center py-6">
            <p className="text-slate-400 mb-4">
              Want to create a personalized storybook for your child?
            </p>
            <Link href="/">
              <Button
                size="lg"
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                Create Your Own Storybook
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
