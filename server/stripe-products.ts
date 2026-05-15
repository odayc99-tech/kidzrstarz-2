/**
 * Stripe Products Configuration
 * Define all products and prices for the KidzRstarz animated storybook service
 */

export const PRODUCTS = {
  PIXAR_TRANSFORMATION: {
    name: "3D Animated Character Storybook",
    description: "Transform your child's photo into a stunning 3D animated character in a personalized storybook video",
    priceInCents: 1999, // $19.99
    currency: "usd",
  },
} as const;

export const getProductPrice = (productKey: keyof typeof PRODUCTS) => {
  return PRODUCTS[productKey].priceInCents;
};

export const getProductPriceInDollars = (productKey: keyof typeof PRODUCTS) => {
  return (PRODUCTS[productKey].priceInCents / 100).toFixed(2);
};
