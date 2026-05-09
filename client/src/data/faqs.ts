export interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
}

/**
 * Frequently asked questions organized by category
 */
export const faqs: FAQ[] = [
  // Privacy & Security
  {
    id: "privacy-1",
    category: "Privacy & Security",
    question: "Is my child's photo secure and private?",
    answer:
      "Yes, absolutely. Your photos are encrypted during transmission and storage. We never share your photos with third parties, and they are only used to generate your Pixar character image. After processing, original photos are securely deleted from our servers within 30 days.",
  },
  {
    id: "privacy-2",
    category: "Privacy & Security",
    question: "What happens to my photos after I download the result?",
    answer:
      "Once you download your Pixar character image, the original photo is automatically deleted from our servers within 30 days. The generated image is yours to keep forever. We don't retain any copies of your original photos.",
  },
  {
    id: "privacy-3",
    category: "Privacy & Security",
    question: "Can you use my photos for training or other purposes?",
    answer:
      "No. We strictly use your photos only to generate your personalized Pixar character image. Your photos are never used for AI model training, marketing, or any other purpose. Your privacy is our top priority.",
  },

  // Turnaround Time
  {
    id: "turnaround-1",
    category: "Turnaround Time",
    question: "How long does it take to generate my Pixar character?",
    answer:
      "Most Pixar character images are generated within 5-15 minutes. The preview is generated almost instantly, and the high-resolution final image typically takes 10-20 minutes depending on server load. You'll receive an email notification when your image is ready.",
  },
  {
    id: "turnaround-2",
    category: "Turnaround Time",
    question: "Can I get my image faster?",
    answer:
      "Our standard processing time is 5-20 minutes. During peak hours, it may take up to 30 minutes. We're constantly optimizing our servers to keep generation times as fast as possible. Priority processing is not currently available, but we're exploring this option.",
  },
  {
    id: "turnaround-3",
    category: "Turnaround Time",
    question: "What if I don't like the preview?",
    answer:
      "You can see the preview before paying, so you know exactly what you're getting. If you're not satisfied with the preview, you can simply not proceed to payment. No charges will be made if you cancel before completing payment.",
  },

  // Payments
  {
    id: "payment-1",
    category: "Payments",
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, American Express) and debit cards through our secure Stripe payment processor. We also support digital payment methods in select regions. All payments are encrypted and PCI-compliant.",
  },
  {
    id: "payment-2",
    category: "Payments",
    question: "Is it safe to enter my credit card information?",
    answer:
      "Yes, completely safe. We use Stripe, one of the most trusted payment processors in the world. Your credit card information is never stored on our servers. All transactions are encrypted with industry-standard SSL security.",
  },
  {
    id: "payment-3",
    category: "Payments",
    question: "Do I pay before or after seeing my character?",
    answer:
      "You always see a preview of your Pixar character before paying. We generate the preview for free so you can review and confirm you're happy with the result. Payment is only required to unlock the full high-resolution image and personalized story.",
  },

  // Technical & Quality
  {
    id: "quality-1",
    category: "Technical & Quality",
    question: "What image resolution will I receive?",
    answer:
      "You'll receive a high-resolution 4K image (3840 x 2160 pixels) that's perfect for printing, framing, or sharing on social media. The preview you see before payment is lower resolution (512 x 512) for quick loading, but the final image is much higher quality.",
  },
  {
    id: "quality-2",
    category: "Technical & Quality",
    question: "What photo quality do I need for best results?",
    answer:
      "For best results, upload a clear, well-lit photo with your child's face clearly visible. A straight-on angle works best. We can work with most photos, but clear, high-quality photos produce the best Pixar character transformations.",
  },
  {
    id: "quality-3",
    category: "Technical & Quality",
    question: "Can I use the image for commercial purposes?",
    answer:
      "The generated Pixar character image is for personal use only. Commercial use, resale, or redistribution is not permitted. If you're interested in commercial licensing, please contact our team for special arrangements.",
  },

  // Account & Usage
  {
    id: "account-1",
    category: "Account & Usage",
    question: "Can I create multiple Pixar characters?",
    answer:
      "Yes! You can create as many Pixar character images as you'd like. Each image is $29.99. There's no limit to how many you can create. You'll have access to all your previous orders in your dashboard.",
  },
  {
    id: "account-2",
    category: "Account & Usage",
    question: "How do I download my image?",
    answer:
      "Once your image is ready, you can download it directly from your dashboard. You'll also receive an email with a download link. The image is available for download for 30 days. We recommend downloading it immediately to ensure you have a copy.",
  },
  {
    id: "account-3",
    category: "Account & Usage",
    question: "What if I have trouble downloading my image?",
    answer:
      "If you experience any technical issues downloading your image, please contact our support team immediately. We'll help you troubleshoot or provide an alternative download method to ensure you receive your image.",
  },

  // Support & Contact
  {
    id: "support-1",
    category: "Support & Contact",
    question: "How do I contact customer support?",
    answer:
      "You can reach our support team by emailing help@kidzrstarz.com or through the contact form on our website. We typically respond within 24 hours during business days. For urgent issues, please include 'URGENT' in your subject line.",
  },
  {
    id: "support-2",
    category: "Support & Contact",
    question: "What if something goes wrong with my order?",
    answer:
      "If you experience any issues with your order, contact our support team with your order number. We'll investigate and work to resolve the issue as quickly as possible, whether that means regenerating your image or providing an alternative solution.",
  },
];

/**
 * Get FAQs grouped by category
 */
export function getFAQsByCategory(): Record<string, FAQ[]> {
  const grouped: Record<string, FAQ[]> = {};
  faqs.forEach((faq) => {
    if (!grouped[faq.category]) {
      grouped[faq.category] = [];
    }
    grouped[faq.category].push(faq);
  });
  return grouped;
}

/**
 * Get unique categories in order
 */
export function getFAQCategories(): string[] {
  const categories = new Set<string>();
  faqs.forEach((faq) => categories.add(faq.category));
  return Array.from(categories);
}
