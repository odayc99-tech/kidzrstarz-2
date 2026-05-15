export interface Testimonial {
  id: string;
  name: string;
  role: string;
  content: string;
  rating: number;
  beforeImage: string;
  afterImage: string;
  childName: string;
}

/**
 * Sample testimonials with before-and-after images
 * In production, these would come from a database
 */
export const testimonials: Testimonial[] = [
  {
    id: "1",
    name: "Sarah Johnson",
    role: "Parent",
    content:
      "My daughter was amazed when she saw herself as an animated character! The quality is absolutely incredible. This is now her favorite picture of herself. Highly recommend!",
    rating: 5,
    childName: "Emma",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-emma-S5wPVT9M4YiMj9cAecGooH.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-emma-ngr59GccDwmLHSQuj9pJXe.webp",
  },
  {
    id: "2",
    name: "Michael Chen",
    role: "Parent",
    content:
      "Used this for my son's birthday party invitations. All the parents were asking where we got such amazing artwork. Worth every penny!",
    rating: 5,
    childName: "Lucas",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-lucas-Qj7Ty35MzyzqzNk7sCNxf9.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-lucas-H3FjX5p2y8o7rrrDtAEUH7.webp",
  },
  {
    id: "3",
    name: "Jessica Martinez",
    role: "Grandmother",
    content:
      "I got this done for my granddaughter and she absolutely loves it! The Pixar style is perfect. It's now hanging on our living room wall. Such a special keepsake!",
    rating: 5,
    childName: "Sophia",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-sophia-CdGPTzxpUsHARxAxiNnTvu.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-sophia-hvLcZx5bUQnnzZga92mV3S.webp",
  },
  {
    id: "4",
    name: "David Thompson",
    role: "Parent",
    content:
      "The process was so easy - just upload a photo and wait. The preview feature let me see exactly what I was getting before paying. Fantastic service!",
    rating: 5,
    childName: "Noah",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-noah-R7G3rNeAqpvyGZaXfLYXHM.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-noah-jvJy8GFSvEBxHnV9ynMpmq.webp",
  },
  {
    id: "5",
    name: "Amanda Wilson",
    role: "Parent",
    content:
      "Perfect gift for my kids! They thought it was so cool seeing themselves as animated characters. The quality exceeded my expectations. Definitely ordering again!",
    rating: 5,
    childName: "Olivia & Liam",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-olivia-KgXUxzhvbeY4D2fDL6Ty87.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-olivia-HJop8Mf7FTkCYPUZ8S4Ucc.webp",
  },
  {
    id: "6",
    name: "Robert Garcia",
    role: "Parent",
    content:
      "Incredible AI technology! The transformation is seamless and the animation style is spot-on. My son wants to frame his and put it in his room. Highly impressed!",
    rating: 5,
    childName: "Diego",
    beforeImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/before-diego-9r8BZ6ixYp5ccqbibPTiDV.webp",
    afterImage:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/after-diego-nVmnkHx2TVTGgWh2amdnFi.webp",
  },
];

export const stats = [
  { label: "Happy Families", value: "5,000+" },
  { label: "Characters Created", value: "12,000+" },
  { label: "5-Star Reviews", value: "98%" },
  { label: "Average Rating", value: "4.9/5" },
];
