/** Built-in high-protein recipes (macros per serving, approximate). Used offline and when AI is off. */
export type Section = 'Produce' | 'Protein' | 'Dairy & eggs' | 'Pantry' | 'Frozen';

export interface Recipe {
  id: string;
  title: string;
  minutes: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  tags: { vegan?: boolean; vegetarian?: boolean; pescatarian?: boolean; glutenFree?: boolean; lactoseFree?: boolean; nutFree?: boolean; lowCarb?: boolean };
  ingredients: { name: string; qty: string; section: Section }[];
  steps: string[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'chicken-rice', title: 'Chicken, rice & broccoli', minutes: 25, kcal: 560, protein: 48, carbs: 62, fat: 11,
    tags: { glutenFree: true, lactoseFree: true, nutFree: true },
    ingredients: [
      { name: 'Chicken breast', qty: '180 g', section: 'Protein' },
      { name: 'Jasmine rice', qty: '75 g dry', section: 'Pantry' },
      { name: 'Broccoli', qty: '150 g', section: 'Produce' },
      { name: 'Olive oil', qty: '1 tsp', section: 'Pantry' },
    ],
    steps: ['Cook rice.', 'Season and pan-sear chicken 6–7 min a side.', 'Steam broccoli 4 min.', 'Plate with lemon and chilli flakes.'],
  },
  {
    id: 'salmon-quinoa', title: 'Salmon, quinoa & greens', minutes: 20, kcal: 590, protein: 42, carbs: 45, fat: 25,
    tags: { pescatarian: true, glutenFree: true, lactoseFree: true, nutFree: true },
    ingredients: [
      { name: 'Salmon fillet', qty: '150 g', section: 'Protein' },
      { name: 'Quinoa', qty: '70 g dry', section: 'Pantry' },
      { name: 'Spinach', qty: '2 handfuls', section: 'Produce' },
      { name: 'Lemon', qty: '1', section: 'Produce' },
    ],
    steps: ['Simmer quinoa 12 min.', 'Roast salmon at 200 °C for 12 min.', 'Wilt spinach in the hot quinoa.', 'Finish with lemon.'],
  },
  {
    id: 'tofu-stirfry', title: 'Crispy tofu veggie stir-fry', minutes: 20, kcal: 480, protein: 32, carbs: 48, fat: 17,
    tags: { vegan: true, vegetarian: true, pescatarian: true, lactoseFree: true, nutFree: true, glutenFree: true },
    ingredients: [
      { name: 'Extra-firm tofu', qty: '200 g', section: 'Protein' },
      { name: 'Mixed stir-fry vegetables', qty: '250 g', section: 'Frozen' },
      { name: 'Tamari (gluten-free soy sauce)', qty: '1 tbsp', section: 'Pantry' },
      { name: 'Brown rice', qty: '60 g dry', section: 'Pantry' },
    ],
    steps: ['Press and cube tofu, fry until golden.', 'Stir-fry vegetables 4 min.', 'Toss with tamari and serve on rice.'],
  },
  {
    id: 'lentil-curry', title: 'Red lentil & chickpea curry', minutes: 30, kcal: 520, protein: 27, carbs: 72, fat: 12,
    tags: { vegan: true, vegetarian: true, pescatarian: true, glutenFree: true, lactoseFree: true, nutFree: true },
    ingredients: [
      { name: 'Red lentils', qty: '70 g dry', section: 'Pantry' },
      { name: 'Chickpeas (can)', qty: '½ can', section: 'Pantry' },
      { name: 'Chopped tomatoes (can)', qty: '½ can', section: 'Pantry' },
      { name: 'Onion & garlic', qty: '½ onion, 2 cloves', section: 'Produce' },
      { name: 'Curry powder', qty: '1 tbsp', section: 'Pantry' },
    ],
    steps: ['Soften onion and garlic, add spices.', 'Add lentils, tomatoes and 300 ml water; simmer 18 min.', 'Stir in chickpeas and heat through.'],
  },
  {
    id: 'yogurt-bowl', title: 'Greek yogurt power bowl', minutes: 5, kcal: 390, protein: 34, carbs: 42, fat: 9,
    tags: { vegetarian: true, pescatarian: true, glutenFree: true, nutFree: true },
    ingredients: [
      { name: 'Greek yogurt (0–2%)', qty: '250 g', section: 'Dairy & eggs' },
      { name: 'Berries', qty: '1 cup', section: 'Produce' },
      { name: 'Oats (gluten-free if needed)', qty: '30 g', section: 'Pantry' },
      { name: 'Honey', qty: '1 tsp', section: 'Pantry' },
    ],
    steps: ['Layer yogurt, oats and berries.', 'Drizzle with honey.'],
  },
  {
    id: 'omelette', title: 'Egg-white & spinach omelette', minutes: 10, kcal: 330, protein: 36, carbs: 8, fat: 16,
    tags: { vegetarian: true, pescatarian: true, glutenFree: true, nutFree: true, lowCarb: true },
    ingredients: [
      { name: 'Eggs', qty: '2 whole + 4 whites', section: 'Dairy & eggs' },
      { name: 'Spinach', qty: '1 handful', section: 'Produce' },
      { name: 'Feta', qty: '30 g', section: 'Dairy & eggs' },
    ],
    steps: ['Whisk eggs.', 'Wilt spinach in a pan, pour in eggs.', 'Add feta, fold and serve.'],
  },
  {
    id: 'turkey-chili', title: 'Lean turkey chili', minutes: 35, kcal: 510, protein: 45, carbs: 40, fat: 15,
    tags: { glutenFree: true, lactoseFree: true, nutFree: true },
    ingredients: [
      { name: 'Lean ground turkey', qty: '170 g', section: 'Protein' },
      { name: 'Kidney beans (can)', qty: '½ can', section: 'Pantry' },
      { name: 'Chopped tomatoes (can)', qty: '½ can', section: 'Pantry' },
      { name: 'Bell pepper & onion', qty: '1 each', section: 'Produce' },
      { name: 'Chili spice mix', qty: '1 tbsp', section: 'Pantry' },
    ],
    steps: ['Brown turkey with onion and pepper.', 'Add spices, tomatoes and beans.', 'Simmer 20 min.'],
  },
  {
    id: 'bean-bowl', title: 'Black bean burrito bowl', minutes: 15, kcal: 540, protein: 26, carbs: 80, fat: 13,
    tags: { vegan: true, vegetarian: true, pescatarian: true, glutenFree: true, lactoseFree: true, nutFree: true },
    ingredients: [
      { name: 'Black beans (can)', qty: '1 can', section: 'Pantry' },
      { name: 'Brown rice', qty: '60 g dry', section: 'Pantry' },
      { name: 'Corn, salsa & avocado', qty: '½ cup, 3 tbsp, ½', section: 'Produce' },
    ],
    steps: ['Warm beans with cumin.', 'Serve over rice with corn, salsa and avocado.'],
  },
  {
    id: 'steak-salad', title: 'Steak & avocado salad', minutes: 15, kcal: 520, protein: 40, carbs: 12, fat: 34,
    tags: { glutenFree: true, lactoseFree: true, nutFree: true, lowCarb: true },
    ingredients: [
      { name: 'Sirloin steak', qty: '170 g', section: 'Protein' },
      { name: 'Mixed greens', qty: '2 cups', section: 'Produce' },
      { name: 'Avocado', qty: '½', section: 'Produce' },
      { name: 'Olive oil & vinegar', qty: '1 tbsp', section: 'Pantry' },
    ],
    steps: ['Sear steak 3–4 min a side, rest 5 min.', 'Slice over greens and avocado, dress.'],
  },
  {
    id: 'tempeh-bowl', title: 'Tempeh satay bowl', minutes: 20, kcal: 610, protein: 35, carbs: 52, fat: 28,
    tags: { vegan: true, vegetarian: true, pescatarian: true, lactoseFree: true },
    ingredients: [
      { name: 'Tempeh', qty: '150 g', section: 'Protein' },
      { name: 'Peanut butter', qty: '1 tbsp', section: 'Pantry' },
      { name: 'Soba noodles', qty: '60 g dry', section: 'Pantry' },
      { name: 'Cucumber & carrot', qty: '1 each', section: 'Produce' },
    ],
    steps: ['Pan-fry sliced tempeh.', 'Whisk peanut butter, soy and lime into a sauce.', 'Toss with noodles and veg.'],
  },
];

export function recipeFits(r: Recipe, diet: string[]): boolean {
  const t = r.tags;
  if (diet.includes('Vegan') && !t.vegan) return false;
  if (diet.includes('Vegetarian') && !t.vegetarian) return false;
  if (diet.includes('Pescatarian') && !t.pescatarian) return false;
  if (diet.includes('Gluten-free') && !t.glutenFree) return false;
  if (diet.includes('Lactose-free') && !t.lactoseFree) return false;
  if (diet.includes('Nut allergy') && !t.nutFree) return false;
  if (diet.includes('Keto / low carb') && !t.lowCarb) return false;
  return true;
}

/** Ranks recipes by protein density (g per 100 kcal), best first. */
export function recipesFor(diet: string[]): Recipe[] {
  return RECIPES.filter((r) => recipeFits(r, diet)).sort((a, b) => b.protein / b.kcal - a.protein / a.kcal);
}

/** Rule-based weekly shopping list from the top recipes (fallback when AI is off). */
export function shoppingFromRecipes(recipes: Recipe[], servingsEach = 3) {
  const map = new Map<Section, { name: string; qty: string; why: string }[]>();
  for (const r of recipes.slice(0, 4)) {
    for (const ing of r.ingredients) {
      const list = map.get(ing.section) ?? [];
      const existing = list.find((x) => x.name === ing.name);
      if (existing) existing.why += `, ${r.title}`;
      else list.push({ name: ing.name, qty: `${ing.qty} × ${servingsEach}`, why: r.title });
      map.set(ing.section, list);
    }
  }
  const order: Section[] = ['Protein', 'Produce', 'Dairy & eggs', 'Pantry', 'Frozen'];
  return order.filter((s) => map.has(s)).map((s) => ({ title: s, items: map.get(s)! }));
}
