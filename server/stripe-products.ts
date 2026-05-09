/**
 * Stripe Products Configuration
 * Define all products and prices for the Pixar transformation service
 */

export const PRODUCTS = {
  PIXAR_TRANSFORMATION: {
    name: "Pixar 3D Character Transformation",
    description: "Transform your child's photo into a stunning 3D Pixar-style character image",
    priceInCents: 2999, // $29.99
    currency: "usd",
  },
} as const;

export const getProductPrice = (productKey: keyof typeof PRODUCTS) => {
  return PRODUCTS[productKey].priceInCents;
};

export const getProductPriceInDollars = (productKey: keyof typeof PRODUCTS) => {
  return (PRODUCTS[productKey].priceInCents / 100).toFixed(2);
};
