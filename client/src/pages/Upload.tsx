import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProgressBar, Step } from "@/components/ProgressBar";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import {
  Upload as UploadIcon,
  Image as ImageIcon,
  X,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mic,
  MicOff,
  Trash2,
  Sparkles,
  Rocket,
  Crown,
  Fish,
  Shield,
  Bone,
  Anchor,
  TreePine,
  UserPlus,
} from "lucide-react";
import { compressImage, formatBytes } from "@/lib/imageCompression";
import { toast } from "sonner";
import { saveGuestToken } from "@/lib/guestToken";

const STEPS: Step[] = [
  { id: "upload", label: "Upload Photo", description: "Choose a clear photo" },
  { id: "details", label: "Details", description: "Name, theme & description" },
  { id: "voice", label: "Voice (Optional)", description: "Clone your voice" },
  { id: "processing", label: "Processing", description: "AI is working" },
];

/**
 * Story theme options with icons and colors for the selector UI.
 */
const THEME_OPTIONS = [
  { id: "adventure", label: "Adventure", icon: Sparkles, color: "from-amber-500 to-orange-500", bgColor: "bg-amber-50 border-amber-200", activeColor: "bg-amber-100 border-amber-500 ring-2 ring-amber-300", description: "Exciting quests through magical lands" },
  { id: "fairytale", label: "Fairy Tale", icon: Crown, color: "from-pink-500 to-rose-500", bgColor: "bg-pink-50 border-pink-200", activeColor: "bg-pink-100 border-pink-500 ring-2 ring-pink-300", description: "Enchanted forests & magical creatures" },
  { id: "space", label: "Space Explorer", icon: Rocket, color: "from-indigo-500 to-blue-500", bgColor: "bg-indigo-50 border-indigo-200", activeColor: "bg-indigo-100 border-indigo-500 ring-2 ring-indigo-300", description: "Journey through the stars" },
  { id: "underwater", label: "Underwater", icon: Fish, color: "from-cyan-500 to-teal-500", bgColor: "bg-cyan-50 border-cyan-200", activeColor: "bg-cyan-100 border-cyan-500 ring-2 ring-cyan-300", description: "Ocean adventures & sea creatures" },
  { id: "superhero", label: "Superhero", icon: Shield, color: "from-red-500 to-rose-500", bgColor: "bg-red-50 border-red-200", activeColor: "bg-red-100 border-red-500 ring-2 ring-red-300", description: "Discover powers & save the day" },
  { id: "dinosaur", label: "Dinosaur Land", icon: Bone, color: "from-green-500 to-emerald-500", bgColor: "bg-green-50 border-green-200", activeColor: "bg-green-100 border-green-500 ring-2 ring-green-300", description: "Travel back to prehistoric times" },
  { id: "pirate", label: "Pirate Treasure", icon: Anchor, color: "from-yellow-600 to-amber-600", bgColor: "bg-yellow-50 border-yellow-200", activeColor: "bg-yellow-100 border-yellow-500 ring-2 ring-yellow-300", description: "Swashbuckling treasure hunts" },
  { id: "enchantedForest", label: "Enchanted Forest", icon: TreePine, color: "from-emerald-500 to-green-600", bgColor: "bg-emerald-50 border-emerald-200", activeColor: "bg-emerald-100 border-emerald-500 ring-2 ring-emerald-300", description: "Talking animals & secret paths" },
];

export default function UploadPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [childDescription, setChildDescription] = useState("");
  const [storyTheme, setStoryTheme] = useState("adventure");
  const [isUploading, setIsUploading] = useState(false);
  const [compressionInfo, setCompressionInfo] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const createOrderMutation = trpc.orders.createOrder.useMutation({
    onSuccess: (data) => {
      toast.success("Order created! Generating your preview...");
      // Save guest token if returned (guest user)
      if (data.guestToken) {
        saveGuestToken(data.orderId, data.guestToken);
      }
      // If voice sample exists, upload it
      if (voiceBlob) {
        uploadVoiceSample(data.orderId, data.guestToken || undefined);
      }
      // Pass guestToken in URL as fallback in case localStorage write is delayed
      const checkoutUrl = data.guestToken
        ? `/checkout?orderId=${data.orderId}&guestToken=${data.guestToken}`
        : `/checkout?orderId=${data.orderId}`;
      setLocation(checkoutUrl);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create order");
      setIsUploading(false);
      setCurrentStep(2);
    },
  });

  const uploadVoiceMutation = trpc.orders.uploadVoiceSample.useMutation({
    onSuccess: () => {
      console.log("Voice sample uploaded successfully");
    },
    onError: (error) => {
      console.warn("Voice upload failed:", error.message);
    },
  });

  const uploadVoiceSample = async (orderId: number, guestToken?: string) => {
    if (!voiceBlob) return;
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadVoiceMutation.mutate({
          orderId,
          audioBase64: base64,
          mimeType: voiceBlob.type || "audio/webm",
          guestToken,
        });
      };
      reader.readAsDataURL(voiceBlob);
    } catch (err) {
      console.warn("Failed to upload voice sample:", err);
    }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (JPEG, PNG, WebP)");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File is too large. Maximum size is 20MB.");
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    setCompressionInfo(`Original: ${formatBytes(file.size)}`);
    setCurrentStep(1);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setVoiceBlob(blob);
        setVoiceUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      toast.error("Could not access microphone. Please check your permissions.");
      console.error("Microphone error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const clearVoice = () => {
    setVoiceBlob(null);
    if (voiceUrl) {
      URL.revokeObjectURL(voiceUrl);
      setVoiceUrl(null);
    }
    setRecordingDuration(0);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSubmit = async () => {
    if (!selectedFile || !childName.trim()) {
      toast.error("Please provide a photo and your child's name");
      return;
    }

    setIsUploading(true);
    setCurrentStep(3);

    try {
      const compressed = await compressImage(selectedFile, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        format: "image/jpeg",
      });

      setCompressionInfo(
        `Original: ${formatBytes(compressed.originalSize)} → Compressed: ${formatBytes(compressed.compressedSize)} (${Math.round(compressed.compressionRatio)}% saved)`
      );

      await createOrderMutation.mutateAsync({
        imageBase64: compressed.base64,
        childName: childName.trim(),
        childDescription: childDescription.trim() || undefined,
        storyTheme,
        mimeType: "image/jpeg",
      });
    } catch (error) {
      console.error("Upload error:", error);
      setIsUploading(false);
      setCurrentStep(2);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setChildName("");
    setChildDescription("");
    setStoryTheme("adventure");
    setCurrentStep(0);
    setIsUploading(false);
    setCompressionInfo(null);
    clearVoice();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="container flex items-center h-16 gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-slate-900">
            Create Your Animated Character
          </h1>
        </div>
      </div>

      {/* Optional Sign-In Banner for guests */}
      {!isAuthenticated && !authLoading && (
        <div className="bg-blue-50 border-b border-blue-100">
          <div className="container flex items-center justify-between py-2.5 gap-3">
            <p className="text-sm text-blue-700">
              <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="font-medium">Create an account</span> to save your orders and access them later from any device.
            </p>
            <a href={getLoginUrl()}>
              <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100 whitespace-nowrap">
                Sign In / Sign Up
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <ProgressBar
        steps={STEPS}
        currentStep={currentStep}
        completedSteps={Array.from({ length: currentStep }, (_, i) => i)}
      />

      {/* Main Content */}
      <div className="container max-w-2xl pb-20">
        {/* Step 1: Upload Photo */}
        {currentStep === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadIcon className="w-5 h-5 text-blue-600" />
                Upload Your Child's Photo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                  dragActive
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/50"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
                <ImageIcon className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                <p className="text-lg font-semibold text-slate-700 mb-2">
                  Drag & drop your photo here
                </p>
                <p className="text-sm text-slate-500 mb-4">
                  or click to browse files
                </p>
                <p className="text-xs text-slate-400">
                  Supports JPEG, PNG, WebP. Max 20MB.
                </p>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">
                  Tips for best results:
                </h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>- Use a clear, well-lit photo with the face visible</li>
                  <li>- Front-facing photos work best</li>
                  <li>- Avoid heavy filters or sunglasses</li>
                  <li>- Single person photos produce the best character</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Enter Details (Name + Description + Theme) */}
        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Tell Us About Your Child</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Preview */}
              {previewUrl && (
                <div className="relative mb-6">
                  <div className="aspect-square max-w-xs mx-auto rounded-xl overflow-hidden shadow-lg">
                    <img
                      src={previewUrl}
                      alt="Selected photo"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    onClick={resetForm}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {compressionInfo && (
                    <p className="text-xs text-slate-500 text-center mt-2">
                      {compressionInfo}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <Label htmlFor="childName" className="text-base font-semibold">
                    Child's Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="childName"
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    placeholder="Enter your child's name"
                    className="mt-2"
                    maxLength={100}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    This name will be used in the personalized story
                  </p>
                </div>

                {/* Story Theme Selector */}
                <div>
                  <Label className="text-base font-semibold">
                    Story Theme <span className="text-red-500">*</span>
                  </Label>
                  <p className="text-xs text-slate-500 mt-1 mb-3">
                    Choose the adventure style for your child's story
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {THEME_OPTIONS.map((theme) => {
                      const Icon = theme.icon;
                      const isSelected = storyTheme === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => setStoryTheme(theme.id)}
                          className={`relative flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                            isSelected
                              ? theme.activeColor
                              : `${theme.bgColor} hover:shadow-md`
                          }`}
                        >
                          <div
                            className={`flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${theme.color} flex items-center justify-center`}
                          >
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-800">
                              {theme.label}
                            </p>
                            <p className="text-xs text-slate-500 leading-tight">
                              {theme.description}
                            </p>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="absolute top-2 right-2 w-5 h-5 text-green-600" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label htmlFor="childDescription" className="text-base font-semibold">
                    Brief Description{" "}
                    <span className="text-slate-400 font-normal text-sm">(optional)</span>
                  </Label>
                  <Textarea
                    id="childDescription"
                    value={childDescription}
                    onChange={(e) => setChildDescription(e.target.value)}
                    placeholder="e.g., 4 years old, brown curly hair, brown eyes, tall for her age, loves wearing pink dresses"
                    className="mt-2 min-h-[100px]"
                    maxLength={500}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Describe your child's appearance (hair color, eye color, height, build, favorite outfit) to make the character more accurate. {childDescription.length}/500
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={resetForm} className="flex-1">
                    Change Photo
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(2)}
                    disabled={!childName.trim()}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    Next: Voice Sample
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Voice Sample (Optional) */}
        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="w-5 h-5 text-purple-600" />
                Voice Sample
                <span className="text-sm font-normal text-slate-400">(Optional)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 mb-6">
                Record a short voice sample (10-30 seconds) and we'll clone your voice using AI to narrate the storybook! 
                Your unique voice will be used to tell your child's personalized story. If you skip this step, 
                we'll use a warm, child-friendly voice for the narration.
              </p>

              {/* Recording UI */}
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-6 mb-6">
                {!voiceBlob ? (
                  <div className="text-center">
                    {isRecording ? (
                      <>
                        <div className="relative inline-flex items-center justify-center mb-4">
                          <div className="absolute w-20 h-20 bg-red-200 rounded-full animate-ping opacity-50" />
                          <button
                            onClick={stopRecording}
                            className="relative w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                          >
                            <MicOff className="w-7 h-7" />
                          </button>
                        </div>
                        <p className="text-lg font-semibold text-red-600 mb-1">
                          Recording... {formatDuration(recordingDuration)}
                        </p>
                        <p className="text-sm text-slate-500">
                          Click to stop recording
                        </p>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={startRecording}
                          className="w-16 h-16 bg-purple-600 hover:bg-purple-700 text-white rounded-full flex items-center justify-center shadow-lg mx-auto mb-4 transition-colors"
                        >
                          <Mic className="w-7 h-7" />
                        </button>
                        <p className="text-lg font-semibold text-slate-700 mb-1">
                          Tap to Record
                        </p>
                        <p className="text-sm text-slate-500">
                          Read a few sentences in a cheerful tone
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <p className="text-lg font-semibold text-slate-700 mb-2">
                      Voice Sample Recorded
                    </p>
                    <p className="text-sm text-slate-500 mb-4">
                      Duration: {formatDuration(recordingDuration)}
                    </p>

                    {voiceUrl && (
                      <audio
                        controls
                        src={voiceUrl}
                        className="mx-auto mb-4"
                        style={{ maxWidth: "100%" }}
                      />
                    )}

                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" size="sm" onClick={clearVoice}>
                        <Trash2 className="w-4 h-4 mr-1" />
                        Re-record
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-amber-50 rounded-lg mb-6">
                <h4 className="font-semibold text-amber-800 mb-2">
                  Recording Tips:
                </h4>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>- Find a quiet environment with minimal background noise</li>
                  <li>- Speak naturally and cheerfully, as if reading to your child</li>
                  <li>- A 10-30 second sample works best</li>
                  <li>- Try reading: "Once upon a time, in a magical land far away, there lived a brave little adventurer who loved to explore."</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(1)}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isUploading}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : voiceBlob ? (
                    "Create Character with Voice"
                  ) : (
                    "Skip & Create Character"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Processing */}
        {currentStep === 3 && (
          <Card>
            <CardContent className="pt-8 text-center">
              <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-6" />
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Creating Your Character
              </h2>
              <p className="text-slate-600 mb-4">
                Our AI is working its magic. This usually takes a few minutes...
              </p>
              <div className="w-full max-w-xs mx-auto bg-slate-200 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 h-full rounded-full animate-pulse w-2/3" />
              </div>
              {compressionInfo && (
                <p className="text-xs text-slate-500 mt-4">{compressionInfo}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
