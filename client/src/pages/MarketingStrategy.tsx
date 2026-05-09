import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Target,
  TrendingUp,
  DollarSign,
  Calendar,
  BarChart3,
  Megaphone,
  Users,
  Search,
  Mail,
  Rocket,
  Share2,
  Gift,
  Handshake,
  Newspaper,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  CheckCircle2,
  Clock,
  Zap,
  Star,
  Globe,
  Video,
  Heart,
  MessageCircle,
  Play,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const TIERS = [
  { id: "free", label: "Free ($0)", icon: Zap, color: "from-green-500 to-emerald-600" },
  { id: "low", label: "Low-Cost ($5-$50/day)", icon: DollarSign, color: "from-blue-500 to-indigo-600" },
  { id: "growth", label: "Growth Accelerators", icon: Rocket, color: "from-purple-500 to-pink-600" },
];

interface Strategy {
  id: number;
  tier: string;
  title: string;
  icon: React.ElementType;
  cost: string;
  timeToResults: string;
  impact: string;
  summary: string;
  details: string[];
  tips: string[];
  table?: { headers: string[]; rows: string[][] };
}

const STRATEGIES: Strategy[] = [
  {
    id: 1,
    tier: "free",
    title: "TikTok Organic Content",
    icon: Megaphone,
    cost: "$0",
    timeToResults: "2-6 weeks",
    impact: "High",
    summary:
      "TikTok's algorithm rewards engaging content regardless of follower count. The 'reveal' moment — a child seeing their Pixar character for the first time — is perfect for this platform.",
    details: [
      "Film parent-child reaction videos when they first see the Pixar character transformation.",
      "Create side-by-side comparisons of the child's real photo next to their Pixar character.",
      "Post 3-5 videos per week using trending sounds and relevant hashtags.",
      "Use hashtags: #PersonalizedGifts, #KidsOfTikTok, #PixarStyle, #MomLife, #GiftIdeas, #AIArt.",
      "Authenticity outperforms polish — genuine phone-recorded reactions beat professional ads.",
    ],
    tips: [
      "A brand-new account can reach hundreds of thousands of viewers with a single compelling video.",
      "Time-lapse videos showing the 'magic' of the transformation perform especially well.",
    ],
    table: {
      headers: ["Metric", "Target"],
      rows: [
        ["Posting frequency", "3-5 videos per week"],
        ["Time to first traction", "2-6 weeks"],
        ["Cost", "$0 (your time only)"],
        ["Key hashtags", "#PersonalizedGifts #KidsOfTikTok #PixarStyle #MomLife"],
      ],
    },
  },
  {
    id: 2,
    tier: "free",
    title: "Instagram Reels & Stories",
    icon: Globe,
    cost: "$0",
    timeToResults: "2-8 weeks",
    impact: "High",
    summary:
      "65% of parents use Instagram multiple times per week. Reels receive significantly more algorithmic distribution than static posts.",
    details: [
      "Cross-post TikTok content to Reels (remove TikTok watermark) to double reach with minimal effort.",
      "Use Stories to show the step-by-step process: upload photo → character generates → story → video reveal.",
      "Leverage interactive Story features: polls, question boxes, and countdown stickers for promotions.",
      "Build a visually cohesive grid showcasing diverse characters, themes, and art styles.",
    ],
    tips: [
      "Feature diverse children and different story themes to help parents envision their own child.",
      "Stories with polls like 'Would your kid love to be a Pixar character?' drive high engagement.",
    ],
  },
  {
    id: 3,
    tier: "free",
    title: "Pinterest — Discovery Engine",
    icon: Search,
    cost: "$0",
    timeToResults: "1-3 months",
    impact: "Medium-High",
    summary:
      "Users come to Pinterest specifically looking for gift ideas and children's activities. Pins have an exceptionally long shelf life — driving traffic for months or years.",
    details: [
      "Create a Pinterest business account with boards: 'Personalized Gifts for Kids,' 'Unique Birthday Gift Ideas,' 'Pixar-Style Kids Art.'",
      "Each pin should feature a high-quality KidzRstarz character image with keyword-rich descriptions.",
      "Post 3+ pins per day for consistent growth.",
      "Include direct links to kidzrstarz.com on every pin.",
    ],
    tips: [
      "'Personalized books for kids' has over 346 active searchers on Pinterest.",
      "Pinterest content continues driving traffic for months — unlike ephemeral TikTok/Instagram content.",
    ],
  },
  {
    id: 4,
    tier: "free",
    title: "Facebook Groups & Communities",
    icon: Users,
    cost: "$0",
    timeToResults: "2-6 weeks",
    impact: "Medium",
    summary:
      "Facebook has the largest concentration of parents actively discussing products and seeking recommendations. Authentic participation in 5-10 groups generates steady early customers.",
    details: [
      "Join parenting groups: mom groups, dad groups, gift idea groups, and local community groups.",
      "Provide value first — answer questions, share tips, become a recognized member before mentioning your product.",
      "Share naturally when context is appropriate (e.g., 'What's a unique birthday gift for a 5-year-old?').",
      "Create your own Facebook Group ('KidzRstarz Parents') as a community hub for customers.",
    ],
    tips: [
      "A personal story about why you created the product resonates more than a sales pitch.",
      "Your own group becomes a powerful asset for word-of-mouth marketing and retention.",
    ],
  },
  {
    id: 5,
    tier: "free",
    title: "SEO & Content Marketing",
    icon: Search,
    cost: "$0",
    timeToResults: "3-6 months",
    impact: "High (compounds)",
    summary:
      "Search engine optimization compounds over time. Target keywords that parents actively search for with genuine value while naturally introducing your product.",
    details: [
      "Write blog posts: 'The 10 Most Unique Personalized Gifts for Kids in 2026,' 'How AI Is Changing Children's Storytelling.'",
      "Each post should be 1,000-2,000 words, well-researched, and optimized for a primary keyword.",
      "Target long-tail keywords with high purchase intent: 'personalized storybook video for kids.'",
      "Include internal links to product pages and clear calls-to-action.",
    ],
    tips: [
      "Long-tail keywords like 'custom Pixar-style character from photo' attract highly qualified visitors.",
      "Informational content ('best personalized gifts for toddlers') builds top-of-funnel awareness.",
    ],
    table: {
      headers: ["SEO Priority", "Target Keywords", "Search Intent"],
      rows: [
        ["High", "personalized storybook for kids, custom children's video book", "Transactional"],
        ["Medium", "unique birthday gifts for kids, personalized gifts for children", "Gift shopping"],
        ["Long-tail", "AI-generated children's story with my child", "High conversion"],
        ["Informational", "best personalized gifts for toddlers", "Brand awareness"],
      ],
    },
  },
  {
    id: 6,
    tier: "free",
    title: "Product Hunt Launch",
    icon: Rocket,
    cost: "$0",
    timeToResults: "1 day (spike)",
    impact: "Medium",
    summary:
      "Product Hunt can generate 500-2,000 site visits in a single day plus ongoing SEO benefits from the high-authority backlink.",
    details: [
      "Schedule launch for Tuesday, Wednesday, or Thursday at 12:01 AM PST.",
      "Prepare: clear tagline ('Turn Your Child Into a Pixar Star'), 1-minute demo video, high-quality screenshots.",
      "Build supporter network by engaging with the community for 2-4 weeks before launch.",
      "Upvotes from established community members carry more weight than new accounts.",
    ],
    tips: [
      "A successful launch generates visibility among tech-savvy early adopters and media.",
      "The high-authority backlink provides ongoing SEO benefits beyond launch day.",
    ],
  },
  {
    id: 7,
    tier: "free",
    title: "Reddit Engagement",
    icon: Users,
    cost: "$0",
    timeToResults: "2-6 weeks",
    impact: "Medium",
    summary:
      "Reddit's parenting communities (r/Parenting, r/Mommit, r/daddit) are active communities where authentic recommendations carry significant weight.",
    details: [
      "Create a personal account and contribute meaningfully for several weeks before sharing your product.",
      "Share only when it genuinely answers someone's question — Reddit users detect and punish overt self-promotion.",
      "Target subreddits: r/Parenting, r/Mommit, r/daddit, r/NewParents, r/GiftIdeas, r/BirthdayIdeas.",
      "A well-timed authentic comment can drive significant traffic if the community finds it helpful.",
    ],
    tips: [
      "Frame it personally: 'I actually built something for this — my kid loved seeing herself as a Pixar character.'",
    ],
  },
  {
    id: 8,
    tier: "free",
    title: "Email List Building",
    icon: Mail,
    cost: "$0",
    timeToResults: "Ongoing",
    impact: "High (best ROI)",
    summary:
      "Email marketing delivers the highest ROI of any digital channel — an average return of $36 for every $1 spent. Start collecting addresses from day one.",
    details: [
      "Add a pop-up or embedded form: 'Get 15% off your first storybook' or 'See a free preview.'",
      "Use free tools: Mailchimp (500 contacts), Brevo (300 emails/day), or MailerLite (1,000 subscribers).",
      "Set up automated sequences: welcome series, abandoned cart reminders, seasonal campaigns.",
      "Send campaigns around birthdays, holidays, and back-to-school.",
    ],
    tips: [
      "The emotional high of seeing their child's video is the perfect moment to ask for a referral.",
      "Email is an owned channel — you're not dependent on algorithm changes.",
    ],
  },
  {
    id: 9,
    tier: "low",
    title: "Meta (Facebook + Instagram) Ads",
    icon: Target,
    cost: "$5-$10/day to start",
    timeToResults: "1-2 weeks",
    impact: "High",
    summary:
      "Meta ads are the primary growth engine behind successful personalized children's product companies. Gift My Book validated their business with just $100 in ad spend and achieved 6-8% conversion.",
    details: [
      "Start with $5-$10/day and test different creative formats.",
      "Use broad targeting: parents of children aged 2-10 in the US. Let Meta's algorithm optimize.",
      "Create 3-5 different ad creatives: transformation video, carousel of styles, testimonial-style ads.",
      "Track cost per acquisition (CPA) — aim below $15 at $29.99 price point.",
      "Scale to $20-$50/day once you find profitable creatives.",
    ],
    tips: [
      "DreamStories.ai scaled to $3-6M revenue primarily through Facebook ads.",
      "UGC-style video ads typically achieve the highest click-through rates (2-4%).",
    ],
    table: {
      headers: ["Ad Format", "Best For", "Expected CTR"],
      rows: [
        ["Video (15-30 sec)", "Showing transformation / child reaction", "1.5-3.0%"],
        ["Carousel", "Showcasing different character styles", "1.0-2.0%"],
        ["Single image", "Retargeting visitors who know the product", "0.8-1.5%"],
        ["UGC-style video", "Building trust with new audiences", "2.0-4.0%"],
      ],
    },
  },
  {
    id: 10,
    tier: "low",
    title: "Nano & Micro-Influencer Partnerships",
    icon: Users,
    cost: "~$0-$150/mo (product cost)",
    timeToResults: "2-4 weeks",
    impact: "High",
    summary:
      "Hooray Heroes reached 15 million followers through 1,615 nano-influencers generating 1,394 posts and 6,147 stories — with 90%+ of their advertising being UGC.",
    details: [
      "Identify parent influencers with 1,000-10,000 followers and high engagement (3-5%+).",
      "Offer a free storybook video in exchange for an honest social media post.",
      "Search hashtags: #MomBlogger, #DadLife, #ParentingTips, #KidsActivities.",
      "Start with 10-20 influencers per month. Even if half post, you build a UGC library.",
      "Repurpose UGC across your own channels and paid ads (with permission).",
    ],
    tips: [
      "At your ~$0 marginal cost, this is extremely affordable advertising.",
      "Nano-influencer content often outperforms professional content because it feels genuine.",
    ],
    table: {
      headers: ["Influencer Tier", "Followers", "Typical Cost", "Expected Reach"],
      rows: [
        ["Nano", "1,000-10,000", "Free product only", "200-2,000"],
        ["Micro", "10,000-50,000", "Free product + $50-$200", "2,000-10,000"],
        ["Mid-tier", "50,000-500,000", "$200-$2,000", "10,000-100,000"],
      ],
    },
  },
  {
    id: 11,
    tier: "low",
    title: "TikTok Ads (Spark Ads)",
    icon: TrendingUp,
    cost: "$10-$20/day",
    timeToResults: "1-2 weeks",
    impact: "Medium-High",
    summary:
      "Amplify your best organic TikTok content (10,000+ views) using Spark Ads. This preserves authenticity while dramatically expanding reach, with CPMs 30-50% lower than Meta.",
    details: [
      "Identify organic videos that get 10,000+ views — these are proven winners.",
      "Use Spark Ads to boost those exact posts as paid advertisements.",
      "The authentic feel is preserved while reach expands dramatically.",
      "Start at $10-$20/day and scale based on performance.",
    ],
    tips: [
      "TikTok CPMs are often 30-50% lower than Meta for consumer products.",
      "Only boost content that's already proven organically — don't guess.",
    ],
  },
  {
    id: 12,
    tier: "growth",
    title: "Referral Program",
    icon: Share2,
    cost: "$5 per referral",
    timeToResults: "1-3 months",
    impact: "High (compounds)",
    summary:
      "Transform every customer into a salesperson. Offer $5 off to both the referrer and the new customer. The emotional high after seeing their child's video is the perfect moment to ask.",
    details: [
      "Offer $5 discount to both parties: referrer gets $5 off next purchase, friend gets $5 off first.",
      "Prompt after storybook delivery: 'Love your child's story? Share with a friend and you both get $5 off!'",
      "Include a unique referral link shareable via text, email, or social media.",
      "Make sharing effortless — one-click copy of referral link.",
    ],
    tips: [
      "Dropbox grew 3,900% in 15 months using a similar referral program.",
      "Parents naturally want to share their child's Pixar character with other parents.",
    ],
  },
  {
    id: 13,
    tier: "growth",
    title: "Seasonal & Occasion Marketing",
    icon: Calendar,
    cost: "Variable",
    timeToResults: "Aligned with seasons",
    impact: "High (during peaks)",
    summary:
      "Personalized children's products see dramatic demand spikes around holidays and occasions. Plan marketing 2-4 weeks before each peak.",
    details: [
      "Ramp up ad spend and content production before each major occasion.",
      "Create occasion-specific messaging and creative assets.",
      "Gift My Book achieved profitability by timing scaling to the holiday gifting season.",
    ],
    tips: [
      "Christmas/holidays and birthdays are the two biggest drivers of personalized gift purchases.",
      "Start preparing holiday campaigns in October for maximum impact.",
    ],
    table: {
      headers: ["Occasion", "Timing", "Marketing Angle"],
      rows: [
        ["Christmas / Holidays", "Nov-Dec", "The most magical gift under the tree"],
        ["Valentine's Day", "Feb", "Show your little one how much they're loved"],
        ["Mother's / Father's Day", "May / June", "A gift from the kids that mom/dad will treasure"],
        ["Back to School", "Aug-Sep", "Start the school year feeling like a star"],
        ["Birthday season", "Year-round", "Make their birthday unforgettable"],
        ["Grandparents Day", "Sep", "The perfect gift from grandma and grandpa"],
      ],
    },
  },
  {
    id: 14,
    tier: "growth",
    title: "Cross-Promotion & Partnerships",
    icon: Handshake,
    cost: "$0-Low",
    timeToResults: "2-4 weeks",
    impact: "Medium-High",
    summary:
      "Partner with non-competing businesses serving the same parent audience: children's clothing brands, activity subscription boxes, family photographers, birthday party planners.",
    details: [
      "Propose mutual promotion: include a KidzRstarz discount card in their orders.",
      "Offer reciprocal promotion in your email newsletter.",
      "Approach local children's boutiques and toy stores about displaying a QR code or flyer.",
      "A single well-placed partnership can drive more traffic than months of organic social posting.",
    ],
    tips: [
      "Family photographers are a natural fit — they already serve parents who value capturing memories.",
      "Birthday party planners can recommend KidzRstarz as a unique party favor or gift.",
    ],
  },
  {
    id: 15,
    tier: "growth",
    title: "PR & Media Outreach",
    icon: Newspaper,
    cost: "$0",
    timeToResults: "Variable",
    impact: "High (if featured)",
    summary:
      "KidzRstarz has a genuinely newsworthy story: AI technology that turns any child into a Pixar-style animated character. One major parenting publication feature can drive thousands of visitors.",
    details: [
      "Create a press kit: high-res before/after images, founder story, key product details.",
      "Pitch to parenting blogs, tech publications, local news, and gift guide editors.",
      "Target writers covering parenting, technology, gift guides, or AI innovation.",
      "The visual nature of the product makes it especially appealing to media outlets.",
    ],
    tips: [
      "Getting featured in Scary Mommy, What to Expect, or Parents magazine can drive thousands of visitors at zero cost.",
      "Holiday gift guide pitches should be sent 2-3 months before the holiday.",
    ],
  },
];

const ACTION_PLAN = [
  {
    phase: "Weeks 1-2",
    title: "Foundation",
    icon: "🏗️",
    tasks: [
      "Set up business accounts on TikTok, Instagram, Pinterest, and Facebook",
      "Create first 5-10 pieces of content (character reveals, transformation videos)",
      "Set up email capture form on kidzrstarz.com with discount incentive",
      "Join 5-10 relevant Facebook Groups and Reddit communities",
      "Create Pinterest business account and publish first 20 pins",
    ],
  },
  {
    phase: "Weeks 3-4",
    title: "Content Momentum",
    icon: "📈",
    tasks: [
      "Establish consistent posting schedule (3-5 TikToks/Reels per week, 3+ pins/day)",
      "Reach out to first 10 nano-influencers with free product offers",
      "Publish first SEO blog post",
      "Prepare Product Hunt launch assets",
    ],
  },
  {
    phase: "Weeks 5-8",
    title: "Amplification",
    icon: "🚀",
    tasks: [
      "Launch on Product Hunt",
      "Start Meta ads test ($5-$10/day) using best organic content as ad creative",
      "Collect and repurpose UGC from influencer partnerships",
      "Send first email campaign to growing subscriber list",
      "Publish 2-3 more blog posts targeting gift-related keywords",
    ],
  },
  {
    phase: "Weeks 9-12",
    title: "Optimization & Scaling",
    icon: "⚡",
    tasks: [
      "Analyze results: which platforms, creatives, and influencers perform best?",
      "Double down on winners, cut underperformers",
      "Scale Meta ad budget to $20-$50/day if CPA is profitable",
      "Launch referral program",
      "Begin outreach to parenting publications for holiday gift guide inclusion",
    ],
  },
];

const BUDGET_ROWS = [
  { strategy: "TikTok / Instagram organic", cost: "$0", impact: "High", time: "2-8 weeks" },
  { strategy: "Pinterest", cost: "$0", impact: "Medium-High", time: "1-3 months" },
  { strategy: "Facebook Groups / Reddit", cost: "$0", impact: "Medium", time: "2-6 weeks" },
  { strategy: "SEO / Blog content", cost: "$0", impact: "High (compounds)", time: "3-6 months" },
  { strategy: "Product Hunt launch", cost: "$0", impact: "Medium (one-time)", time: "1 day" },
  { strategy: "Email marketing", cost: "$0 (free tier)", impact: "High (best ROI)", time: "Ongoing" },
  { strategy: "Nano-influencer outreach", cost: "~$0-$150", impact: "High", time: "2-4 weeks" },
  { strategy: "Meta ads (starter)", cost: "$150-$300", impact: "High", time: "1-2 weeks" },
  { strategy: "TikTok ads (starter)", cost: "$150-$300", impact: "Medium-High", time: "1-2 weeks" },
  { strategy: "Referral program", cost: "$5/referral", impact: "High (compounds)", time: "1-3 months" },
];

const METRICS = [
  { metric: "Website visitors", meaning: "Overall awareness and reach", target: "Growing month-over-month" },
  { metric: "Conversion rate", meaning: "How well your site turns visitors into buyers", target: "3-8%" },
  { metric: "Cost per acquisition (CPA)", meaning: "How much you spend to get one customer", target: "Below $15" },
  { metric: "Customer lifetime value (LTV)", meaning: "Total revenue per customer over time", target: "3:1 LTV-to-CPA" },
  { metric: "Email list size", meaning: "Owned audience you can market to for free", target: "Growing weekly" },
  { metric: "Social engagement rate", meaning: "Content quality and audience resonance", target: "3-5%+" },
  { metric: "Referral rate", meaning: "How many customers refer others", target: "10-20%" },
];

/* ------------------------------------------------------------------ */
/*  UGC TikTok Showcase Data                                           */
/* ------------------------------------------------------------------ */

interface TikTokVideo {
  id: string;
  tiktokUrl: string;
  embedId: string;
  creatorName: string;
  creatorHandle: string;
  description: string;
  likes: string;
  comments: string;
  thumbnail?: string;
}

// Sample placeholder videos — replace with real community TikToks
const DEFAULT_TIKTOK_VIDEOS: TikTokVideo[] = [
  {
    id: "1",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/1",
    embedId: "",
    creatorName: "Sarah M.",
    creatorHandle: "@sarahsmomlife",
    description: "My daughter's face when she saw herself as a Pixar character!! Absolutely priceless moment we'll treasure forever.",
    likes: "12.4K",
    comments: "847",
  },
  {
    id: "2",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/2",
    embedId: "",
    creatorName: "Jessica T.",
    creatorHandle: "@jesst_creates",
    description: "Best birthday gift EVER! My son watched his storybook video 10 times in a row. The narration is so good!",
    likes: "8.7K",
    comments: "523",
  },
  {
    id: "3",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/3",
    embedId: "",
    creatorName: "Mike D.",
    creatorHandle: "@dadlife_mike",
    description: "Grandma cried when she saw the storybook video we made for her grandkids. This is the perfect gift for grandparents!",
    likes: "15.2K",
    comments: "1.1K",
  },
  {
    id: "4",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/4",
    embedId: "",
    creatorName: "Emma L.",
    creatorHandle: "@emma_and_littles",
    description: "The underwater theme is INCREDIBLE. My twins couldn't believe they were swimming with dolphins in their own movie!",
    likes: "6.3K",
    comments: "412",
  },
  {
    id: "5",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/5",
    embedId: "",
    creatorName: "Priya K.",
    creatorHandle: "@priyakmom",
    description: "Side by side of my daughter's photo vs her Pixar character. The resemblance is unreal! AI is amazing.",
    likes: "22.1K",
    comments: "1.8K",
  },
  {
    id: "6",
    tiktokUrl: "https://www.tiktok.com/@kidzrstarz/video/6",
    embedId: "",
    creatorName: "Carlos R.",
    creatorHandle: "@carlos_familyfun",
    description: "Christmas morning surprise! All 3 kids got their own personalized storybook videos. Best reaction ever!",
    likes: "31.5K",
    comments: "2.4K",
  },
];

/* ------------------------------------------------------------------ */
/*  TikTok UGC Card Component                                          */
/* ------------------------------------------------------------------ */

function TikTokCard({ video }: { video: TikTokVideo }) {
  const [isHovered, setIsHovered] = useState(false);

  // Generate a gradient based on the video id for visual variety
  const gradients = [
    "from-pink-500 via-red-500 to-yellow-500",
    "from-purple-500 via-pink-500 to-red-500",
    "from-blue-500 via-purple-500 to-pink-500",
    "from-cyan-500 via-blue-500 to-purple-500",
    "from-green-400 via-cyan-500 to-blue-500",
    "from-orange-500 via-red-500 to-pink-500",
  ];
  const gradientIndex = parseInt(video.id) % gradients.length;
  const gradient = gradients[gradientIndex];

  return (
    <div
      className="group relative rounded-2xl overflow-hidden bg-white border border-purple-100 shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video Thumbnail Area */}
      <div className="relative aspect-[9/16] max-h-[320px] overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-90`} />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4">
          <div className={`w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3 transition-transform duration-300 ${isHovered ? 'scale-110' : ''}`}>
            <Play className="w-8 h-8 text-white ml-1" />
          </div>
          <p className="text-sm text-white/80 text-center font-medium line-clamp-3 px-2">
            {video.description}
          </p>
        </div>

        {/* TikTok Logo Badge */}
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="white">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.73a8.19 8.19 0 004.76 1.52V6.8a4.84 4.84 0 01-1-.11z" />
          </svg>
          <span className="text-[10px] text-white font-semibold">TikTok</span>
        </div>

        {/* Engagement overlay on hover */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-3 text-white text-xs">
            <span className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5 fill-red-400 text-red-400" />
              {video.likes}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" />
              {video.comments}
            </span>
          </div>
        </div>
      </div>

      {/* Creator Info */}
      <div className="p-3.5">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
            {video.creatorName.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{video.creatorName}</p>
            <p className="text-xs text-gray-500 truncate">{video.creatorHandle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  UGC Section Component                                              */
/* ------------------------------------------------------------------ */

function UGCShowcase() {
  const [videos] = useState<TikTokVideo[]>(DEFAULT_TIKTOK_VIDEOS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = 300;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <SectionAnchor id="community">
      <section>
        <div className="text-center mb-8">
          <Badge className="bg-pink-100 text-pink-700 border-pink-200 mb-3">
            <Video className="w-3.5 h-3.5 mr-1" />
            Community Spotlight
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
            Real Parents, Real Reactions
          </h2>
          <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
            See what our community is sharing on TikTok — these authentic moments are our most powerful marketing asset.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap justify-center gap-3 sm:gap-6 mb-8">
          {[
            { label: "Community Videos", value: "50+", icon: Video },
            { label: "Total Likes", value: "96K+", icon: Heart },
            { label: "Comments", value: "7.1K+", icon: MessageCircle },
          ].map((stat, i) => {
            const StatIcon = stat.icon;
            return (
              <div key={i} className="flex items-center gap-2 bg-white rounded-full px-4 py-2 border border-pink-100 shadow-sm">
                <StatIcon className="w-4 h-4 text-pink-500" />
                <span className="text-sm font-bold text-gray-900">{stat.value}</span>
                <span className="text-xs text-gray-500 hidden sm:inline">{stat.label}</span>
              </div>
            );
          })}
        </div>

        {/* Scrollable video grid */}
        <div className="relative">
          {/* Scroll buttons */}
          {canScrollLeft && (
            <button
              onClick={() => scroll("left")}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/90 shadow-lg border border-purple-100 flex items-center justify-center text-purple-600 hover:bg-purple-50 transition-colors -ml-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {canScrollRight && (
            <button
              onClick={() => scroll("right")}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/90 shadow-lg border border-purple-100 flex items-center justify-center text-purple-600 hover:bg-purple-50 transition-colors -mr-2 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {videos.map((video) => (
              <div key={video.id} className="flex-shrink-0 w-[220px] sm:w-[240px] snap-start">
                <TikTokCard video={video} />
              </div>
            ))}

            {/* CTA Card */}
            <div className="flex-shrink-0 w-[220px] sm:w-[240px] snap-start">
              <div className="rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/50 h-full flex flex-col items-center justify-center p-6 text-center min-h-[320px]">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white mb-4">
                  <Plus className="w-7 h-7" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">Share Your Video!</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Tag <span className="font-semibold text-pink-600">@kidzrstarz</span> on TikTok and your video could be featured here!
                </p>
                <a
                  href="https://www.tiktok.com/tag/kidzrstarz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-600 hover:text-pink-700 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View #KidzRstarz on TikTok
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Hashtag CTA */}
        <div className="mt-6 text-center">
          <Card className="inline-block bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200/50">
            <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.73a8.19 8.19 0 004.76 1.52V6.8a4.84 4.84 0 01-1-.11z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-900">Join the community!</p>
                  <p className="text-xs text-gray-500">Use <span className="font-semibold text-pink-600">#KidzRstarz</span> and <span className="font-semibold text-pink-600">#PixarKids</span> when posting</p>
                </div>
              </div>
              <a
                href="https://www.tiktok.com/tag/kidzrstarz"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white text-xs">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Browse #KidzRstarz
                </Button>
              </a>
            </CardContent>
          </Card>
        </div>
      </section>
    </SectionAnchor>
  );
}

const REFERENCES = [
  { id: 1, text: "Personalized Story Books for Kids Market Research Report", url: "https://growthmarketreports.com/report/personalized-story-books-for-kids-market", source: "Growth Market Reports (2024)" },
  { id: 2, text: "How DreamStories.ai Made $3M+ Selling AI-Generated Children's Books", url: "https://medium.com/write-a-catalyst/how-dreamstories-ai-made-3m-selling-ai-generated-childrens-books-and-how-you-can-too-20ef49ceb88b", source: "Medium (2026)" },
  { id: 3, text: "Case Study: How Gift My Book Reached $1M ARR in Just 3 Months", url: "https://base44.com/blog/base44-case-study-gift-my-book", source: "Base44 (2026)" },
  { id: 4, text: "How Hooray Heroes Used Nano Influencer Marketing", url: "https://www.epidemic.co/how-hooray-heroes-used-nano-influencer-marketing-to-create-authentic-user-generated-content", source: "Epidemic (2023)" },
  { id: 5, text: "TikTok for Startups: Zero-Budget Growth Strategy", url: "https://www.tokportal.com/use-cases/tiktok-for-startups-zero-budget-growth-strategy", source: "TokPortal (2026)" },
  { id: 6, text: "The Platforms Winning with Parents in 2025", url: "https://www.linkedin.com/pulse/platforms-winning-parents-2025-macaroni-kid-nnvjc", source: "LinkedIn / Macaroni Kid" },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StrategyCard({ strategy, isOpen, onToggle }: { strategy: Strategy; isOpen: boolean; onToggle: () => void }) {
  const Icon = strategy.icon;
  const impactColor =
    strategy.impact.includes("High") ? "bg-green-100 text-green-700" :
    strategy.impact.includes("Medium") ? "bg-yellow-100 text-yellow-700" :
    "bg-gray-100 text-gray-600";

  return (
    <Card className="border-purple-200/50 hover:border-purple-300/70 transition-all duration-200 overflow-hidden bg-white">
      <button
        onClick={onToggle}
        className="w-full text-left p-5 sm:p-6 flex items-start gap-4 cursor-pointer"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white mt-0.5">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-bold text-gray-900 font-heading">{strategy.title}</h3>
            <div className="flex-shrink-0 mt-1">
              {isOpen ? (
                <ChevronDown className="w-5 h-5 text-purple-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-purple-400" />
              )}
            </div>
          </div>
          <p className="text-gray-600 text-sm mt-1 line-clamp-2">{strategy.summary}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant="outline" className="text-xs border-purple-200 text-purple-600">
              <DollarSign className="w-3 h-3 mr-1" />
              {strategy.cost}
            </Badge>
            <Badge variant="outline" className="text-xs border-blue-200 text-blue-600">
              <Clock className="w-3 h-3 mr-1" />
              {strategy.timeToResults}
            </Badge>
            <Badge className={`text-xs ${impactColor} border-0`}>
              <TrendingUp className="w-3 h-3 mr-1" />
              {strategy.impact}
            </Badge>
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="px-5 sm:px-6 pb-6 border-t border-purple-100 pt-4">
          <div className="space-y-4">
            {/* Action Steps */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Action Steps
              </h4>
              <ul className="space-y-1.5">
                {strategy.details.map((d, i) => (
                  <li key={i} className="text-sm text-gray-600 pl-5 relative before:content-[''] before:absolute before:left-1.5 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-purple-300">
                    {d}
                  </li>
                ))}
              </ul>
            </div>

            {/* Tips */}
            {strategy.tips.length > 0 && (
              <div className="bg-amber-50 rounded-lg p-3.5">
                <h4 className="text-sm font-semibold text-amber-800 mb-1.5 flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  Pro Tips
                </h4>
                <ul className="space-y-1">
                  {strategy.tips.map((t, i) => (
                    <li key={i} className="text-sm text-amber-700">{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Table */}
            {strategy.table && (
              <div className="overflow-x-auto rounded-lg border border-purple-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-purple-50">
                      {strategy.table.headers.map((h, i) => (
                        <th key={i} className="text-left px-3 py-2 font-semibold text-purple-800 text-xs uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {strategy.table.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-purple-50/30"}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 text-gray-700">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SectionAnchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function MarketingStrategy() {
  const [activeTier, setActiveTier] = useState("free");
  const [openStrategies, setOpenStrategies] = useState<Set<number>>(new Set());

  const toggleStrategy = (id: number) => {
    setOpenStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredStrategies = STRATEGIES.filter((s) => s.tier === activeTier);
  const activeTierData = TIERS.find((t) => t.id === activeTier)!;

  const NAV_ITEMS = [
    { id: "market", label: "Market Position" },
    { id: "strategies", label: "Strategies" },
    { id: "action-plan", label: "90-Day Plan" },
    { id: "budget", label: "Budget" },
    { id: "metrics", label: "Metrics" },
    { id: "community", label: "Community" },
    { id: "references", label: "References" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-pink-50/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-purple-100">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-purple-600 hover:text-purple-800 hover:bg-purple-50 -ml-2">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Home
              </Button>
            </Link>
            <div className="hidden sm:block h-5 w-px bg-purple-200" />
            <h1 className="hidden sm:block text-sm font-semibold text-purple-800 font-heading">Marketing Strategy</h1>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-xs font-medium text-gray-500 hover:text-purple-600 px-2.5 py-1.5 rounded-md hover:bg-purple-50 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600" />
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-32 h-32 rounded-full bg-white animate-pulse" />
          <div className="absolute bottom-10 right-20 w-24 h-24 rounded-full bg-white animate-pulse" style={{ animationDelay: "1s" }} />
          <div className="absolute top-1/2 left-1/3 w-16 h-16 rounded-full bg-white animate-pulse" style={{ animationDelay: "2s" }} />
        </div>
        <div className="container relative py-16 sm:py-20 text-center">
          <Badge className="bg-white/20 text-white border-white/30 mb-4 text-sm px-4 py-1">
            <Star className="w-3.5 h-3.5 mr-1.5" />
            Comprehensive Marketing Guide
          </Badge>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white font-heading leading-tight max-w-3xl mx-auto">
            KidzRstarz Marketing Strategy
          </h1>
          <p className="text-purple-100 text-lg sm:text-xl mt-4 max-w-2xl mx-auto leading-relaxed">
            A budget-friendly plan to reach parents and drive sales — from $0 organic tactics to strategic paid growth
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 text-white">
              <div className="text-2xl font-bold">15</div>
              <div className="text-xs text-purple-200">Strategies</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 text-white">
              <div className="text-2xl font-bold">3</div>
              <div className="text-xs text-purple-200">Budget Tiers</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 text-white">
              <div className="text-2xl font-bold">90</div>
              <div className="text-xs text-purple-200">Day Action Plan</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 text-white">
              <div className="text-2xl font-bold">$0</div>
              <div className="text-xs text-purple-200">Minimum Budget</div>
            </div>
          </div>
        </div>
      </section>

      <div className="container py-10 sm:py-14 space-y-14 sm:space-y-20">
        {/* Executive Summary */}
        <section>
          <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200/50">
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-bold text-purple-900 font-heading mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Executive Summary
              </h2>
              <p className="text-gray-700 leading-relaxed">
                KidzRstarz occupies a compelling position in the personalized children's product market, which reached <strong>$1.48 billion globally in 2024</strong>. The product — an AI-powered Pixar-style storybook video featuring a child's own likeness — is inherently shareable, emotionally resonant, and perfectly suited for gift-giving occasions. This guide presents a tiered marketing plan drawing on real-world case studies from <strong>DreamStories.ai</strong> ($3-6M revenue), <strong>Gift My Book</strong> ($1M ARR in 3 months with just $100 in ads), and <strong>Hooray Heroes</strong> (15 million followers via nano-influencer UGC).
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Market Position */}
        <SectionAnchor id="market">
          <section>
            <div className="text-center mb-8">
              <Badge className="bg-purple-100 text-purple-700 border-purple-200 mb-3">
                <Target className="w-3.5 h-3.5 mr-1" />
                Market Position
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
                Understanding Your Competitive Edge
              </h2>
              <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
                KidzRstarz sits at the intersection of personalization, AI-generated content, and children's media — three of the most powerful consumer trends.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: "Product Format", value: "Animated video storybook (not just a static book or PDF)", icon: "🎬" },
                { label: "Emotional Hook", value: "Child becomes a Pixar-style character — parents love this", icon: "💜" },
                { label: "Shareability", value: "Video format is natively shareable on all social platforms", icon: "📱" },
                { label: "Gift Potential", value: "Perfect for birthdays, holidays, grandparent gifts", icon: "🎁" },
                { label: "Price Point", value: "$29.99 — affordable impulse purchase / gift range", icon: "💰" },
                { label: "Repeat Potential", value: "New stories, themes, and characters encourage repeat purchases", icon: "🔄" },
              ].map((item, i) => (
                <Card key={i} className="bg-white border-purple-100 hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="text-2xl mb-2">{item.icon}</div>
                    <h3 className="font-semibold text-gray-900 text-sm">{item.label}</h3>
                    <p className="text-gray-600 text-sm mt-1">{item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="mt-6 bg-white border-blue-100">
              <CardContent className="p-5 sm:p-6">
                <h3 className="font-semibold text-gray-900 mb-2">Target Audience</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  <strong>Primary:</strong> Parents aged 25-45, with a strong skew toward mothers active on Instagram, Facebook, TikTok, and Pinterest. <strong>Secondary:</strong> Grandparents, aunts/uncles, and family friends looking for unique birthday or holiday gifts.
                </p>
              </CardContent>
            </Card>
          </section>
        </SectionAnchor>

        {/* Strategies */}
        <SectionAnchor id="strategies">
          <section>
            <div className="text-center mb-8">
              <Badge className="bg-purple-100 text-purple-700 border-purple-200 mb-3">
                <Megaphone className="w-3.5 h-3.5 mr-1" />
                Marketing Strategies
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
                15 Proven Strategies Across 3 Tiers
              </h2>
              <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
                From completely free tactics to strategic paid investments — start with what costs nothing and scale as revenue grows.
              </p>
            </div>

            {/* Tier Tabs */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {TIERS.map((tier) => {
                const TierIcon = tier.icon;
                const isActive = activeTier === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => setActiveTier(tier.id)}
                    className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
                      isActive
                        ? `bg-gradient-to-r ${tier.color} text-white shadow-lg shadow-purple-200`
                        : "bg-white text-gray-600 border border-gray-200 hover:border-purple-300 hover:text-purple-600"
                    }`}
                  >
                    <TierIcon className="w-4 h-4" />
                    {tier.label}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-gray-100"}`}>
                      {STRATEGIES.filter((s) => s.tier === tier.id).length}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tier Description */}
            <div className={`mb-6 p-4 rounded-xl bg-gradient-to-r ${activeTierData.color} text-white`}>
              <p className="text-sm font-medium text-center">
                {activeTier === "free" && "These strategies require only your time and creativity. They form the foundation of a sustainable marketing engine."}
                {activeTier === "low" && "Once free strategies are running, these modest paid investments ($5-$50/day) can accelerate growth significantly."}
                {activeTier === "growth" && "These strategies require more planning but can deliver outsized returns as your business scales."}
              </p>
            </div>

            {/* Strategy Cards */}
            <div className="space-y-3">
              {filteredStrategies.map((strategy) => (
                <StrategyCard
                  key={strategy.id}
                  strategy={strategy}
                  isOpen={openStrategies.has(strategy.id)}
                  onToggle={() => toggleStrategy(strategy.id)}
                />
              ))}
            </div>
          </section>
        </SectionAnchor>

        {/* 90-Day Action Plan */}
        <SectionAnchor id="action-plan">
          <section>
            <div className="text-center mb-8">
              <Badge className="bg-purple-100 text-purple-700 border-purple-200 mb-3">
                <Calendar className="w-3.5 h-3.5 mr-1" />
                Action Plan
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
                First 90 Days Roadmap
              </h2>
              <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
                Prioritized by impact and cost — start free and layer in paid tactics as you validate what works.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {ACTION_PLAN.map((phase, i) => (
                <Card key={i} className="bg-white border-purple-100 hover:shadow-md transition-shadow overflow-hidden">
                  <div className={`h-1.5 bg-gradient-to-r ${
                    i === 0 ? "from-green-400 to-emerald-500" :
                    i === 1 ? "from-blue-400 to-indigo-500" :
                    i === 2 ? "from-purple-400 to-purple-600" :
                    "from-pink-400 to-rose-500"
                  }`} />
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-2xl">{phase.icon}</span>
                      <div>
                        <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide">{phase.phase}</div>
                        <h3 className="text-lg font-bold text-gray-900 font-heading">{phase.title}</h3>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {phase.tasks.map((task, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-gray-600">
                          <CheckCircle2 className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                          <span>{task}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </SectionAnchor>

        {/* Budget Summary */}
        <SectionAnchor id="budget">
          <section>
            <div className="text-center mb-8">
              <Badge className="bg-purple-100 text-purple-700 border-purple-200 mb-3">
                <DollarSign className="w-3.5 h-3.5 mr-1" />
                Budget
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
                Monthly Budget Summary
              </h2>
              <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
                Start as low as $0 and scale to $300-$750/month — a fraction of what competitors spend.
              </p>
            </div>

            <Card className="bg-white border-purple-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-purple-50 to-pink-50">
                      <th className="text-left px-4 py-3 font-semibold text-purple-800 text-xs uppercase tracking-wide">Strategy</th>
                      <th className="text-left px-4 py-3 font-semibold text-purple-800 text-xs uppercase tracking-wide">Monthly Cost</th>
                      <th className="text-left px-4 py-3 font-semibold text-purple-800 text-xs uppercase tracking-wide">Impact</th>
                      <th className="text-left px-4 py-3 font-semibold text-purple-800 text-xs uppercase tracking-wide">Time to Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BUDGET_ROWS.map((row, i) => (
                      <tr key={i} className={`border-t border-purple-50 ${i % 2 === 0 ? "bg-white" : "bg-purple-50/20"}`}>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.strategy}</td>
                        <td className="px-4 py-3 text-gray-600">{row.cost}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs border-0 ${
                            row.impact.includes("High") ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {row.impact}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.time}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gradient-to-r from-purple-100 to-pink-100 border-t-2 border-purple-200">
                      <td className="px-4 py-3 font-bold text-purple-900">Total (conservative start)</td>
                      <td className="px-4 py-3 font-bold text-purple-900">$300-$750/month</td>
                      <td colSpan={2} className="px-4 py-3 text-sm text-purple-700 italic">
                        A fraction of what competitors spend
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </section>
        </SectionAnchor>

        {/* Key Metrics */}
        <SectionAnchor id="metrics">
          <section>
            <div className="text-center mb-8">
              <Badge className="bg-purple-100 text-purple-700 border-purple-200 mb-3">
                <BarChart3 className="w-3.5 h-3.5 mr-1" />
                Key Metrics
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 font-heading">
                What to Measure
              </h2>
              <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
                Focus on these core numbers to ensure you invest where it generates the most return.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {METRICS.map((m, i) => (
                <Card key={i} className="bg-white border-purple-100 hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <h3 className="font-bold text-gray-900 text-sm">{m.metric}</h3>
                    <p className="text-gray-500 text-xs mt-1">{m.meaning}</p>
                    <div className="mt-3 px-3 py-1.5 bg-purple-50 rounded-lg">
                      <span className="text-sm font-semibold text-purple-700">Target: {m.target}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </SectionAnchor>

        {/* Final Recommendation */}
        <section>
          <Card className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 border-0 text-white overflow-hidden relative">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-5 right-10 w-20 h-20 rounded-full bg-white animate-pulse" />
              <div className="absolute bottom-5 left-10 w-16 h-16 rounded-full bg-white animate-pulse" style={{ animationDelay: "1s" }} />
            </div>
            <CardContent className="p-6 sm:p-8 relative">
              <h2 className="text-xl sm:text-2xl font-bold font-heading mb-3">
                The Bottom Line
              </h2>
              <p className="text-purple-100 leading-relaxed">
                The most important insight from studying successful competitors is that <strong className="text-white">the product itself is the best marketing asset</strong>. A child seeing themselves as a Pixar character for the first time creates a genuinely emotional moment that parents want to share. Every strategy in this guide is about creating opportunities for that moment to be witnessed by more parents.
              </p>
              <p className="text-purple-100 leading-relaxed mt-3">
                Start with free strategies — they cost nothing but your time and can generate meaningful traction within weeks. Layer in paid advertising once you validate which content resonates. <strong className="text-white">Consistency matters more than perfection</strong>: a steady stream of authentic, emotionally compelling content will outperform sporadic bursts of polished advertising every time.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* UGC Community Showcase */}
        <UGCShowcase />

        {/* References */}
        <SectionAnchor id="references">
          <section>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900 font-heading">References & Sources</h2>
            </div>
            <div className="space-y-2">
              {REFERENCES.map((ref) => (
                <a
                  key={ref.id}
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-purple-50 transition-colors group"
                >
                  <span className="text-xs font-mono text-purple-400 mt-0.5">[{ref.id}]</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-700 group-hover:text-purple-700 transition-colors">{ref.text}</span>
                    <span className="text-xs text-gray-400 ml-1">— {ref.source}</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-purple-400 flex-shrink-0 mt-1" />
                </a>
              ))}
            </div>
          </section>
        </SectionAnchor>
      </div>

      {/* Footer */}
      <footer className="border-t border-purple-100 bg-purple-50/50 py-8">
        <div className="container text-center">
          <p className="text-sm text-gray-500">
            KidzRstarz Marketing Strategy Guide — Built for{" "}
            <a href="https://kidzrstarz.com" className="text-purple-600 hover:underline">kidzrstarz.com</a>
          </p>
          <div className="mt-3">
            <Link href="/">
              <Button variant="outline" size="sm" className="text-purple-600 border-purple-200 hover:bg-purple-50">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Back to KidzRstarz
              </Button>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
