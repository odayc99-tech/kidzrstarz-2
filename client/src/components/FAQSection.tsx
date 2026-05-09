import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getFAQsByCategory, getFAQCategories } from "@/data/faqs";

export default function FAQSection() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const categories = getFAQCategories();
  const faqsByCategory = getFAQsByCategory();

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <section className="py-20 bg-white">
      <div className="container max-w-4xl">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-slate-600">
            Find answers to common questions about privacy, turnaround time, payments, and more.
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="space-y-8">
          {categories.map((category) => (
            <div key={category}>
              {/* Category Header */}
              <h3 className="text-2xl font-bold text-slate-800 mb-4 pb-4 border-b-2 border-blue-200">
                {category}
              </h3>

              {/* FAQ Items */}
              <div className="space-y-3">
                {faqsByCategory[category].map((faq) => (
                  <Card
                    key={faq.id}
                    className="overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <button
                      onClick={() => toggleExpanded(faq.id)}
                      className="w-full px-6 py-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                    >
                      <h4 className="font-semibold text-slate-800 text-lg pr-4">
                        {faq.question}
                      </h4>
                      <ChevronDown
                        className={`w-5 h-5 text-blue-600 flex-shrink-0 transition-transform duration-300 ${
                          expandedId === faq.id ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Answer - Collapsible */}
                    {expandedId === faq.id && (
                      <div className="px-6 py-4 bg-white border-t border-slate-200">
                        <p className="text-slate-700 leading-relaxed">
                          {faq.answer}
                        </p>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Contact CTA */}
        <div className="mt-16 p-8 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200">
          <h3 className="text-2xl font-bold text-slate-900 mb-3">
            Still have questions?
          </h3>
          <p className="text-slate-700 mb-4">
            Can't find the answer you're looking for? Our support team is here to help.
          </p>
          <a
            href="mailto:help@kidzrstarz.com"
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Contact Support
          </a>
        </div>
      </div>
    </section>
  );
}
