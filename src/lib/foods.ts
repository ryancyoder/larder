import type { Item, StorageKind } from '../db/schema'

/**
 * Basic foods, as distinct from products.
 *
 * A kitchen holds products — "Bush's canned beets", "beets from the garden",
 * "freeze-dried beet powder". A cook thinks in foods: do I have any beets?
 * Those are different questions and the app could only answer the first one,
 * which is why "have I got carrots?" needed you to already know how you'd
 * written them down.
 *
 * The library is reference data, not user data, so it lives in code rather than
 * in a table: it is the same for every kitchen, it wants to grow with the app,
 * and a key that items point at must not be deletable out from under them.
 *
 * One entry per basic food, deliberately coarse. Beef is beef — not brisket,
 * mince and chuck. Cheese is cheese. Raisins are grapes that dried, so they are
 * grapes. Where the coarse name isn't what someone would type, `aka` carries
 * the words they'd actually search for, and those also drive matching.
 */

export type FoodGroupKey =
  | 'veg' | 'fruit' | 'grain' | 'legume' | 'nut' | 'meat' | 'seafood'
  | 'dairy' | 'herb' | 'fat' | 'sweet' | 'drink' | 'basic'

export interface FoodGroup {
  key: FoodGroupKey
  label: string
  icon: string
}

export interface Food {
  key: string
  name: string
  /**
   * An icon, never a photograph. A product has a picture — that's what makes it
   * that product. A basic food is the abstraction over all of them, so it gets
   * a drawn mark instead; a photo of one particular carrot would quietly claim
   * to be the carrot.
   */
  icon: string
  group: FoodGroupKey
  /** Other names and the forms that fold into this food, for search and matching. */
  aka?: string[]
}

export const FOOD_GROUPS: FoodGroup[] = [
  { key: 'veg', label: 'Vegetables', icon: '🥕' },
  { key: 'fruit', label: 'Fruit', icon: '🍎' },
  { key: 'grain', label: 'Grains', icon: '🌾' },
  { key: 'legume', label: 'Beans & legumes', icon: '🫘' },
  { key: 'nut', label: 'Nuts & seeds', icon: '🥜' },
  { key: 'meat', label: 'Meat', icon: '🥩' },
  { key: 'seafood', label: 'Seafood', icon: '🐟' },
  { key: 'dairy', label: 'Dairy & eggs', icon: '🥛' },
  { key: 'herb', label: 'Herbs & spices', icon: '🌿' },
  { key: 'fat', label: 'Fats & oils', icon: '🫒' },
  { key: 'sweet', label: 'Sweeteners', icon: '🍯' },
  { key: 'drink', label: 'Drinks', icon: '☕' },
  { key: 'basic', label: 'Pantry basics', icon: '🧂' },
]

export const FOODS: Food[] = [
  // --- Vegetables ---------------------------------------------------------
  { key: 'artichoke', name: 'Artichoke', icon: '🌿', group: 'veg', aka: ['artichoke hearts'] },
  { key: 'asparagus', name: 'Asparagus', icon: '🥬', group: 'veg' },
  { key: 'aubergine', name: 'Aubergine', icon: '🍆', group: 'veg', aka: ['eggplant', 'brinjal'] },
  { key: 'bamboo-shoot', name: 'Bamboo shoots', icon: '🥬', group: 'veg' },
  { key: 'beet', name: 'Beetroot', icon: '🫜', group: 'veg', aka: ['beet', 'beets', 'beetroot'] },
  { key: 'bell-pepper', name: 'Bell pepper', icon: '🫑', group: 'veg', aka: ['capsicum', 'sweet pepper', 'red pepper', 'green pepper', 'peppers'] },
  { key: 'bok-choy', name: 'Bok choy', icon: '🥬', group: 'veg', aka: ['pak choi'] },
  { key: 'broccoli', name: 'Broccoli', icon: '🥦', group: 'veg', aka: ['broccolini'] },
  { key: 'brussels-sprout', name: 'Brussels sprouts', icon: '🥬', group: 'veg' },
  { key: 'cabbage', name: 'Cabbage', icon: '🥬', group: 'veg', aka: ['sauerkraut', 'kimchi', 'coleslaw'] },
  { key: 'carrot', name: 'Carrot', icon: '🥕', group: 'veg', aka: ['baby carrots'] },
  { key: 'cauliflower', name: 'Cauliflower', icon: '🥦', group: 'veg' },
  { key: 'celeriac', name: 'Celeriac', icon: '🥬', group: 'veg', aka: ['celery root'] },
  { key: 'celery', name: 'Celery', icon: '🥬', group: 'veg' },
  { key: 'chard', name: 'Chard', icon: '🥬', group: 'veg', aka: ['swiss chard', 'silverbeet'] },
  { key: 'chilli', name: 'Chilli pepper', icon: '🌶️', group: 'veg', aka: ['chili pepper', 'jalapeno', 'habanero', 'serrano', 'poblano'] },
  { key: 'collard', name: 'Collard greens', icon: '🥬', group: 'veg' },
  { key: 'corn', name: 'Corn', icon: '🌽', group: 'veg', aka: ['sweetcorn', 'cornmeal', 'polenta', 'grits', 'hominy'] },
  { key: 'cucumber', name: 'Cucumber', icon: '🥒', group: 'veg', aka: ['pickle', 'pickles', 'gherkin', 'dill pickles'] },
  { key: 'fennel', name: 'Fennel', icon: '🥬', group: 'veg' },
  { key: 'garlic', name: 'Garlic', icon: '🧄', group: 'veg', aka: ['garlic powder', 'garlic cloves'] },
  { key: 'ginger', name: 'Ginger', icon: '🫚', group: 'veg', aka: ['ground ginger'] },
  { key: 'green-bean', name: 'Green beans', icon: '🫛', group: 'veg', aka: ['string beans', 'runner beans'] },
  { key: 'horseradish', name: 'Horseradish', icon: '🥬', group: 'veg' },
  { key: 'kale', name: 'Kale', icon: '🥬', group: 'veg' },
  { key: 'leek', name: 'Leek', icon: '🥬', group: 'veg' },
  { key: 'lettuce', name: 'Lettuce', icon: '🥬', group: 'veg', aka: ['romaine', 'iceberg', 'salad greens', 'mixed greens'] },
  { key: 'mushroom', name: 'Mushroom', icon: '🍄', group: 'veg', aka: ['portobello', 'shiitake', 'cremini', 'button mushrooms'] },
  { key: 'okra', name: 'Okra', icon: '🥬', group: 'veg' },
  { key: 'olive', name: 'Olives', icon: '🫒', group: 'veg' },
  { key: 'onion', name: 'Onion', icon: '🧅', group: 'veg', aka: ['onion powder', 'red onion', 'white onion'] },
  { key: 'parsnip', name: 'Parsnip', icon: '🥕', group: 'veg' },
  { key: 'pea', name: 'Peas', icon: '🫛', group: 'veg', aka: ['garden peas', 'snap peas', 'snow peas'] },
  { key: 'potato', name: 'Potato', icon: '🥔', group: 'veg', aka: ['potatoes', 'fries', 'chips', 'hash browns', 'mashed potato'] },
  { key: 'pumpkin', name: 'Pumpkin', icon: '🎃', group: 'veg' },
  { key: 'radish', name: 'Radish', icon: '🥬', group: 'veg', aka: ['daikon'] },
  { key: 'rhubarb', name: 'Rhubarb', icon: '🥬', group: 'veg' },
  { key: 'seaweed', name: 'Seaweed', icon: '🌿', group: 'veg', aka: ['nori', 'kelp', 'wakame'] },
  { key: 'shallot', name: 'Shallot', icon: '🧅', group: 'veg' },
  { key: 'spinach', name: 'Spinach', icon: '🥬', group: 'veg' },
  { key: 'spring-onion', name: 'Spring onion', icon: '🧅', group: 'veg', aka: ['scallion', 'green onion'] },
  { key: 'sprouts', name: 'Sprouts', icon: '🌱', group: 'veg', aka: ['bean sprouts', 'alfalfa'] },
  { key: 'squash', name: 'Squash', icon: '🎃', group: 'veg', aka: ['butternut', 'acorn squash', 'spaghetti squash'] },
  { key: 'swede', name: 'Swede', icon: '🥬', group: 'veg', aka: ['rutabaga'] },
  { key: 'sweet-potato', name: 'Sweet potato', icon: '🍠', group: 'veg', aka: ['yam', 'yams'] },
  { key: 'tomato', name: 'Tomato', icon: '🍅', group: 'veg', aka: ['tomatoes', 'passata', 'marinara', 'tomato sauce', 'tomato paste', 'crushed tomatoes', 'sun dried tomatoes'] },
  { key: 'turnip', name: 'Turnip', icon: '🥬', group: 'veg' },
  { key: 'water-chestnut', name: 'Water chestnuts', icon: '🥬', group: 'veg' },
  { key: 'zucchini', name: 'Zucchini', icon: '🥒', group: 'veg', aka: ['courgette'] },

  // --- Fruit --------------------------------------------------------------
  { key: 'apple', name: 'Apple', icon: '🍎', group: 'fruit', aka: ['apples', 'applesauce', 'apple sauce'] },
  { key: 'apricot', name: 'Apricot', icon: '🍑', group: 'fruit' },
  { key: 'avocado', name: 'Avocado', icon: '🥑', group: 'fruit', aka: ['guacamole'] },
  { key: 'banana', name: 'Banana', icon: '🍌', group: 'fruit', aka: ['bananas'] },
  { key: 'blackberry', name: 'Blackberry', icon: '🫐', group: 'fruit', aka: ['blackberries'] },
  { key: 'blueberry', name: 'Blueberry', icon: '🫐', group: 'fruit', aka: ['blueberries'] },
  { key: 'cherry', name: 'Cherry', icon: '🍒', group: 'fruit', aka: ['cherries'] },
  { key: 'coconut', name: 'Coconut', icon: '🥥', group: 'fruit', aka: ['coconut milk', 'coconut cream', 'desiccated coconut'] },
  { key: 'cranberry', name: 'Cranberry', icon: '🫐', group: 'fruit', aka: ['cranberries', 'craisins'] },
  { key: 'date', name: 'Dates', icon: '🌴', group: 'fruit', aka: ['medjool'] },
  { key: 'fig', name: 'Fig', icon: '🫐', group: 'fruit', aka: ['figs'] },
  { key: 'grape', name: 'Grape', icon: '🍇', group: 'fruit', aka: ['grapes', 'raisin', 'raisins', 'sultana', 'sultanas'] },
  { key: 'grapefruit', name: 'Grapefruit', icon: '🍊', group: 'fruit' },
  { key: 'guava', name: 'Guava', icon: '🥭', group: 'fruit' },
  { key: 'kiwi', name: 'Kiwi', icon: '🥝', group: 'fruit', aka: ['kiwifruit'] },
  { key: 'lemon', name: 'Lemon', icon: '🍋', group: 'fruit', aka: ['lemons', 'lemon juice'] },
  { key: 'lime', name: 'Lime', icon: '🍋', group: 'fruit', aka: ['limes', 'lime juice'] },
  { key: 'mango', name: 'Mango', icon: '🥭', group: 'fruit', aka: ['mangoes'] },
  { key: 'melon', name: 'Melon', icon: '🍈', group: 'fruit', aka: ['cantaloupe', 'honeydew'] },
  { key: 'nectarine', name: 'Nectarine', icon: '🍑', group: 'fruit' },
  { key: 'orange', name: 'Orange', icon: '🍊', group: 'fruit', aka: ['oranges', 'mandarin', 'clementine', 'satsuma', 'tangerine'] },
  { key: 'papaya', name: 'Papaya', icon: '🥭', group: 'fruit' },
  { key: 'passion-fruit', name: 'Passion fruit', icon: '🥭', group: 'fruit' },
  { key: 'peach', name: 'Peach', icon: '🍑', group: 'fruit', aka: ['peaches'] },
  { key: 'pear', name: 'Pear', icon: '🍐', group: 'fruit', aka: ['pears'] },
  { key: 'persimmon', name: 'Persimmon', icon: '🍊', group: 'fruit' },
  { key: 'pineapple', name: 'Pineapple', icon: '🍍', group: 'fruit' },
  { key: 'plantain', name: 'Plantain', icon: '🍌', group: 'fruit' },
  { key: 'plum', name: 'Plum', icon: '🍑', group: 'fruit', aka: ['plums', 'prune', 'prunes'] },
  { key: 'pomegranate', name: 'Pomegranate', icon: '🍎', group: 'fruit' },
  { key: 'raspberry', name: 'Raspberry', icon: '🫐', group: 'fruit', aka: ['raspberries'] },
  { key: 'strawberry', name: 'Strawberry', icon: '🍓', group: 'fruit', aka: ['strawberries'] },
  { key: 'watermelon', name: 'Watermelon', icon: '🍉', group: 'fruit' },

  // --- Grains -------------------------------------------------------------
  { key: 'barley', name: 'Barley', icon: '🌾', group: 'grain' },
  { key: 'bread', name: 'Bread', icon: '🍞', group: 'grain', aka: ['loaf', 'sourdough', 'baguette', 'bagel', 'bun', 'roll', 'rolls', 'pita', 'naan', 'breadcrumbs', 'toast'] },
  { key: 'buckwheat', name: 'Buckwheat', icon: '🌾', group: 'grain', aka: ['soba'] },
  { key: 'bulgur', name: 'Bulgur', icon: '🌾', group: 'grain' },
  { key: 'cereal', name: 'Breakfast cereal', icon: '🥣', group: 'grain', aka: ['cornflakes', 'muesli', 'granola'] },
  { key: 'couscous', name: 'Couscous', icon: '🌾', group: 'grain' },
  { key: 'cracker', name: 'Crackers', icon: '🍘', group: 'grain', aka: ['crispbread', 'water biscuits'] },
  { key: 'farro', name: 'Farro', icon: '🌾', group: 'grain' },
  { key: 'millet', name: 'Millet', icon: '🌾', group: 'grain' },
  { key: 'noodle', name: 'Noodles', icon: '🍜', group: 'grain', aka: ['ramen', 'udon', 'rice noodles', 'egg noodles'] },
  { key: 'oats', name: 'Oats', icon: '🌾', group: 'grain', aka: ['oatmeal', 'porridge', 'rolled oats'] },
  { key: 'pasta', name: 'Pasta', icon: '🍝', group: 'grain', aka: ['spaghetti', 'penne', 'macaroni', 'fusilli', 'linguine', 'lasagne', 'lasagna', 'rigatoni', 'orzo'] },
  { key: 'popcorn', name: 'Popcorn', icon: '🍿', group: 'grain' },
  { key: 'quinoa', name: 'Quinoa', icon: '🌾', group: 'grain' },
  { key: 'rice', name: 'Rice', icon: '🍚', group: 'grain', aka: ['basmati', 'jasmine rice', 'arborio', 'brown rice', 'white rice'] },
  { key: 'rye', name: 'Rye', icon: '🌾', group: 'grain' },
  { key: 'sorghum', name: 'Sorghum', icon: '🌾', group: 'grain' },
  { key: 'spelt', name: 'Spelt', icon: '🌾', group: 'grain' },
  { key: 'tortilla', name: 'Tortilla', icon: '🫓', group: 'grain', aka: ['wrap', 'wraps', 'taco shells'] },
  { key: 'wheat', name: 'Wheat flour', icon: '🌾', group: 'grain', aka: ['flour', 'plain flour', 'all purpose flour', 'bread flour', 'self raising flour'] },

  // --- Beans & legumes ----------------------------------------------------
  { key: 'black-bean', name: 'Black beans', icon: '🫘', group: 'legume' },
  { key: 'black-eyed-pea', name: 'Black-eyed peas', icon: '🫘', group: 'legume' },
  { key: 'butter-bean', name: 'Butter beans', icon: '🫘', group: 'legume', aka: ['lima beans'] },
  { key: 'cannellini', name: 'Cannellini beans', icon: '🫘', group: 'legume', aka: ['white beans'] },
  { key: 'chickpea', name: 'Chickpeas', icon: '🫘', group: 'legume', aka: ['garbanzo', 'garbanzo beans', 'hummus'] },
  { key: 'kidney-bean', name: 'Kidney beans', icon: '🫘', group: 'legume' },
  { key: 'lentil', name: 'Lentils', icon: '🫘', group: 'legume', aka: ['red lentils', 'green lentils', 'dal'] },
  { key: 'mung-bean', name: 'Mung beans', icon: '🫘', group: 'legume' },
  { key: 'navy-bean', name: 'Navy beans', icon: '🫘', group: 'legume', aka: ['baked beans', 'haricot beans'] },
  { key: 'pinto-bean', name: 'Pinto beans', icon: '🫘', group: 'legume', aka: ['refried beans'] },
  { key: 'soybean', name: 'Soybeans', icon: '🫘', group: 'legume', aka: ['edamame', 'soya beans'] },
  { key: 'split-pea', name: 'Split peas', icon: '🫘', group: 'legume' },
  { key: 'tempeh', name: 'Tempeh', icon: '🫘', group: 'legume' },
  { key: 'tofu', name: 'Tofu', icon: '🫘', group: 'legume', aka: ['bean curd'] },

  // --- Nuts & seeds -------------------------------------------------------
  { key: 'almond', name: 'Almonds', icon: '🥜', group: 'nut', aka: ['almond butter', 'ground almonds', 'almond flour'] },
  { key: 'brazil-nut', name: 'Brazil nuts', icon: '🥜', group: 'nut' },
  { key: 'cashew', name: 'Cashews', icon: '🥜', group: 'nut', aka: ['cashew butter'] },
  { key: 'chestnut', name: 'Chestnuts', icon: '🌰', group: 'nut' },
  { key: 'chia', name: 'Chia seeds', icon: '🥜', group: 'nut' },
  { key: 'flaxseed', name: 'Flaxseed', icon: '🥜', group: 'nut', aka: ['linseed'] },
  { key: 'hazelnut', name: 'Hazelnuts', icon: '🌰', group: 'nut', aka: ['filbert'] },
  { key: 'macadamia', name: 'Macadamias', icon: '🥜', group: 'nut' },
  { key: 'peanut', name: 'Peanuts', icon: '🥜', group: 'nut', aka: ['peanut butter', 'groundnut'] },
  { key: 'pecan', name: 'Pecans', icon: '🥜', group: 'nut' },
  { key: 'pine-nut', name: 'Pine nuts', icon: '🥜', group: 'nut' },
  { key: 'pistachio', name: 'Pistachios', icon: '🥜', group: 'nut' },
  { key: 'poppy-seed', name: 'Poppy seeds', icon: '🥜', group: 'nut' },
  { key: 'pumpkin-seed', name: 'Pumpkin seeds', icon: '🥜', group: 'nut', aka: ['pepitas'] },
  { key: 'sesame', name: 'Sesame seeds', icon: '🥜', group: 'nut', aka: ['tahini'] },
  { key: 'sunflower-seed', name: 'Sunflower seeds', icon: '🥜', group: 'nut' },
  { key: 'walnut', name: 'Walnuts', icon: '🥜', group: 'nut' },

  // --- Meat ---------------------------------------------------------------
  { key: 'beef', name: 'Beef', icon: '🥩', group: 'meat', aka: ['steak', 'mince', 'ground beef', 'brisket', 'chuck', 'sirloin', 'ribeye', 'roast beef', 'stewing beef'] },
  { key: 'bison', name: 'Bison', icon: '🥩', group: 'meat', aka: ['buffalo'] },
  { key: 'chicken', name: 'Chicken', icon: '🍗', group: 'meat', aka: ['chicken breast', 'chicken thighs', 'drumsticks', 'wings', 'rotisserie chicken'] },
  { key: 'deli-meat', name: 'Deli meat', icon: '🥓', group: 'meat', aka: ['salami', 'pepperoni', 'bologna', 'pastrami', 'lunch meat'] },
  { key: 'duck', name: 'Duck', icon: '🦆', group: 'meat' },
  { key: 'goat', name: 'Goat', icon: '🐐', group: 'meat' },
  { key: 'lamb', name: 'Lamb', icon: '🍖', group: 'meat', aka: ['mutton'] },
  { key: 'offal', name: 'Offal', icon: '🍖', group: 'meat', aka: ['liver', 'kidneys', 'heart'] },
  { key: 'pork', name: 'Pork', icon: '🥓', group: 'meat', aka: ['bacon', 'ham', 'gammon', 'prosciutto', 'pancetta', 'pork chops', 'pork belly', 'ribs'] },
  { key: 'rabbit', name: 'Rabbit', icon: '🐇', group: 'meat' },
  { key: 'sausage', name: 'Sausage', icon: '🌭', group: 'meat', aka: ['sausages', 'chorizo', 'bratwurst', 'hot dogs', 'frankfurters'] },
  { key: 'turkey', name: 'Turkey', icon: '🦃', group: 'meat' },
  { key: 'veal', name: 'Veal', icon: '🥩', group: 'meat' },
  { key: 'venison', name: 'Venison', icon: '🦌', group: 'meat', aka: ['deer'] },

  // --- Seafood ------------------------------------------------------------
  { key: 'anchovy', name: 'Anchovies', icon: '🐟', group: 'seafood' },
  { key: 'bass', name: 'Bass', icon: '🐟', group: 'seafood', aka: ['sea bass'] },
  { key: 'clam', name: 'Clams', icon: '🦪', group: 'seafood' },
  { key: 'cod', name: 'Cod', icon: '🐟', group: 'seafood' },
  { key: 'crab', name: 'Crab', icon: '🦀', group: 'seafood' },
  { key: 'haddock', name: 'Haddock', icon: '🐟', group: 'seafood' },
  { key: 'halibut', name: 'Halibut', icon: '🐟', group: 'seafood' },
  { key: 'herring', name: 'Herring', icon: '🐟', group: 'seafood', aka: ['kipper'] },
  { key: 'lobster', name: 'Lobster', icon: '🦞', group: 'seafood' },
  { key: 'mackerel', name: 'Mackerel', icon: '🐟', group: 'seafood' },
  { key: 'mussel', name: 'Mussels', icon: '🦪', group: 'seafood' },
  { key: 'octopus', name: 'Octopus', icon: '🐙', group: 'seafood' },
  { key: 'oyster', name: 'Oysters', icon: '🦪', group: 'seafood' },
  { key: 'salmon', name: 'Salmon', icon: '🐟', group: 'seafood', aka: ['smoked salmon', 'lox'] },
  { key: 'sardine', name: 'Sardines', icon: '🐟', group: 'seafood' },
  { key: 'scallop', name: 'Scallops', icon: '🦪', group: 'seafood' },
  { key: 'shrimp', name: 'Shrimp', icon: '🦐', group: 'seafood', aka: ['prawn', 'prawns'] },
  { key: 'snapper', name: 'Snapper', icon: '🐟', group: 'seafood' },
  { key: 'squid', name: 'Squid', icon: '🦑', group: 'seafood', aka: ['calamari'] },
  { key: 'tilapia', name: 'Tilapia', icon: '🐟', group: 'seafood' },
  { key: 'trout', name: 'Trout', icon: '🐟', group: 'seafood' },
  { key: 'tuna', name: 'Tuna', icon: '🐟', group: 'seafood' },

  // --- Dairy & eggs -------------------------------------------------------
  { key: 'butter', name: 'Butter', icon: '🧈', group: 'dairy' },
  { key: 'buttermilk', name: 'Buttermilk', icon: '🥛', group: 'dairy' },
  { key: 'cheese', name: 'Cheese', icon: '🧀', group: 'dairy', aka: ['cheddar', 'mozzarella', 'parmesan', 'feta', 'gouda', 'brie', 'halloumi', 'ricotta', 'blue cheese'] },
  { key: 'condensed-milk', name: 'Condensed milk', icon: '🥛', group: 'dairy', aka: ['evaporated milk'] },
  { key: 'cottage-cheese', name: 'Cottage cheese', icon: '🥛', group: 'dairy' },
  { key: 'cream', name: 'Cream', icon: '🥛', group: 'dairy', aka: ['double cream', 'heavy cream', 'whipping cream'] },
  { key: 'cream-cheese', name: 'Cream cheese', icon: '🧀', group: 'dairy' },
  { key: 'egg', name: 'Eggs', icon: '🥚', group: 'dairy', aka: ['egg'] },
  { key: 'ghee', name: 'Ghee', icon: '🧈', group: 'dairy' },
  { key: 'ice-cream', name: 'Ice cream', icon: '🍦', group: 'dairy', aka: ['gelato', 'sorbet'] },
  { key: 'kefir', name: 'Kefir', icon: '🥛', group: 'dairy' },
  { key: 'milk', name: 'Milk', icon: '🥛', group: 'dairy', aka: ['whole milk', 'skim milk', 'semi skimmed'] },
  { key: 'sour-cream', name: 'Sour cream', icon: '🥛', group: 'dairy', aka: ['creme fraiche'] },
  { key: 'yogurt', name: 'Yogurt', icon: '🥛', group: 'dairy', aka: ['yoghurt', 'greek yogurt'] },

  // --- Herbs & spices -----------------------------------------------------
  { key: 'allspice', name: 'Allspice', icon: '🌿', group: 'herb' },
  { key: 'basil', name: 'Basil', icon: '🌿', group: 'herb', aka: ['pesto'] },
  { key: 'bay-leaf', name: 'Bay leaves', icon: '🌿', group: 'herb' },
  // "Pepper" on its own is the spice; "peppers" is the vegetable. Both are
  // spelled out so neither has to win by the accident of a plural rule.
  { key: 'black-pepper', name: 'Black pepper', icon: '🌿', group: 'herb', aka: ['peppercorns', 'ground pepper', 'pepper'] },
  { key: 'cardamom', name: 'Cardamom', icon: '🌿', group: 'herb' },
  { key: 'cayenne', name: 'Cayenne', icon: '🌶️', group: 'herb' },
  { key: 'chilli-powder', name: 'Chilli powder', icon: '🌶️', group: 'herb', aka: ['chili powder', 'red pepper flakes'] },
  { key: 'chives', name: 'Chives', icon: '🌿', group: 'herb' },
  { key: 'cinnamon', name: 'Cinnamon', icon: '🌿', group: 'herb' },
  { key: 'clove', name: 'Cloves', icon: '🌿', group: 'herb' },
  { key: 'coriander', name: 'Coriander', icon: '🌿', group: 'herb', aka: ['cilantro'] },
  { key: 'cumin', name: 'Cumin', icon: '🌿', group: 'herb' },
  { key: 'curry-powder', name: 'Curry powder', icon: '🌿', group: 'herb', aka: ['garam masala', 'curry paste'] },
  { key: 'dill', name: 'Dill', icon: '🌿', group: 'herb' },
  { key: 'fennel-seed', name: 'Fennel seeds', icon: '🌿', group: 'herb' },
  { key: 'mint', name: 'Mint', icon: '🌿', group: 'herb' },
  { key: 'mustard-seed', name: 'Mustard seeds', icon: '🌿', group: 'herb' },
  { key: 'nutmeg', name: 'Nutmeg', icon: '🌿', group: 'herb' },
  { key: 'oregano', name: 'Oregano', icon: '🌿', group: 'herb' },
  { key: 'paprika', name: 'Paprika', icon: '🌶️', group: 'herb' },
  { key: 'parsley', name: 'Parsley', icon: '🌿', group: 'herb' },
  { key: 'rosemary', name: 'Rosemary', icon: '🌿', group: 'herb' },
  { key: 'saffron', name: 'Saffron', icon: '🌿', group: 'herb' },
  { key: 'sage', name: 'Sage', icon: '🌿', group: 'herb' },
  { key: 'salt', name: 'Salt', icon: '🧂', group: 'herb', aka: ['sea salt', 'kosher salt'] },
  { key: 'star-anise', name: 'Star anise', icon: '🌿', group: 'herb' },
  { key: 'tarragon', name: 'Tarragon', icon: '🌿', group: 'herb' },
  { key: 'thyme', name: 'Thyme', icon: '🌿', group: 'herb' },
  { key: 'turmeric', name: 'Turmeric', icon: '🌿', group: 'herb' },
  { key: 'vanilla', name: 'Vanilla', icon: '🌿', group: 'herb', aka: ['vanilla extract'] },

  // --- Fats & oils --------------------------------------------------------
  { key: 'avocado-oil', name: 'Avocado oil', icon: '🫒', group: 'fat' },
  { key: 'canola-oil', name: 'Canola oil', icon: '🫒', group: 'fat', aka: ['rapeseed oil'] },
  { key: 'coconut-oil', name: 'Coconut oil', icon: '🫒', group: 'fat' },
  { key: 'lard', name: 'Lard', icon: '🫒', group: 'fat', aka: ['dripping', 'tallow'] },
  { key: 'margarine', name: 'Margarine', icon: '🧈', group: 'fat', aka: ['spread'] },
  { key: 'olive-oil', name: 'Olive oil', icon: '🫒', group: 'fat', aka: ['extra virgin olive oil'] },
  { key: 'peanut-oil', name: 'Peanut oil', icon: '🫒', group: 'fat', aka: ['groundnut oil'] },
  { key: 'sesame-oil', name: 'Sesame oil', icon: '🫒', group: 'fat' },
  { key: 'shortening', name: 'Shortening', icon: '🫒', group: 'fat' },
  { key: 'sunflower-oil', name: 'Sunflower oil', icon: '🫒', group: 'fat' },
  { key: 'vegetable-oil', name: 'Vegetable oil', icon: '🫒', group: 'fat', aka: ['cooking oil'] },

  // --- Sweeteners ---------------------------------------------------------
  { key: 'agave', name: 'Agave syrup', icon: '🍯', group: 'sweet' },
  { key: 'chocolate', name: 'Chocolate', icon: '🍫', group: 'sweet', aka: ['chocolate chips', 'dark chocolate', 'milk chocolate'] },
  { key: 'cocoa', name: 'Cocoa', icon: '🍫', group: 'sweet', aka: ['cacao', 'cocoa powder'] },
  { key: 'corn-syrup', name: 'Corn syrup', icon: '🍯', group: 'sweet', aka: ['golden syrup'] },
  { key: 'honey', name: 'Honey', icon: '🍯', group: 'sweet' },
  { key: 'jam', name: 'Jam', icon: '🍯', group: 'sweet', aka: ['jelly', 'preserves', 'marmalade'] },
  { key: 'maple-syrup', name: 'Maple syrup', icon: '🍯', group: 'sweet' },
  { key: 'molasses', name: 'Molasses', icon: '🍯', group: 'sweet', aka: ['treacle'] },
  { key: 'stevia', name: 'Stevia', icon: '🍯', group: 'sweet', aka: ['sweetener'] },
  { key: 'sugar', name: 'Sugar', icon: '🍬', group: 'sweet', aka: ['brown sugar', 'caster sugar', 'icing sugar', 'powdered sugar', 'granulated sugar'] },

  // --- Drinks -------------------------------------------------------------
  { key: 'beer', name: 'Beer', icon: '🍺', group: 'drink', aka: ['lager', 'ale', 'cider'] },
  { key: 'coffee', name: 'Coffee', icon: '☕', group: 'drink', aka: ['espresso', 'ground coffee', 'coffee beans'] },
  { key: 'juice', name: 'Juice', icon: '🧃', group: 'drink', aka: ['orange juice', 'apple juice'] },
  { key: 'kombucha', name: 'Kombucha', icon: '🫖', group: 'drink' },
  { key: 'milk-alternative', name: 'Milk alternative', icon: '🥛', group: 'drink', aka: ['almond milk', 'oat milk', 'soy milk', 'soya milk', 'rice milk'] },
  { key: 'soda', name: 'Soda', icon: '🥤', group: 'drink', aka: ['cola', 'fizzy drink', 'pop', 'lemonade'] },
  { key: 'sparkling-water', name: 'Sparkling water', icon: '💧', group: 'drink', aka: ['seltzer', 'soda water'] },
  { key: 'spirits', name: 'Spirits', icon: '🥃', group: 'drink', aka: ['whisky', 'whiskey', 'vodka', 'gin', 'rum', 'tequila'] },
  { key: 'tea', name: 'Tea', icon: '🍵', group: 'drink', aka: ['green tea', 'black tea', 'herbal tea'] },
  { key: 'water', name: 'Water', icon: '💧', group: 'drink', aka: ['bottled water'] },
  { key: 'wine', name: 'Wine', icon: '🍷', group: 'drink', aka: ['red wine', 'white wine', 'prosecco', 'champagne'] },

  // --- Pantry basics ------------------------------------------------------
  { key: 'baking-powder', name: 'Baking powder', icon: '🧂', group: 'basic' },
  { key: 'baking-soda', name: 'Baking soda', icon: '🧂', group: 'basic', aka: ['bicarbonate of soda', 'bicarb'] },
  { key: 'cornstarch', name: 'Cornstarch', icon: '🧂', group: 'basic', aka: ['cornflour'] },
  { key: 'fish-sauce', name: 'Fish sauce', icon: '🫙', group: 'basic', aka: ['nam pla'] },
  { key: 'gelatin', name: 'Gelatin', icon: '🧂', group: 'basic', aka: ['gelatine'] },
  { key: 'hot-sauce', name: 'Hot sauce', icon: '🫙', group: 'basic', aka: ['sriracha', 'tabasco'] },
  { key: 'ketchup', name: 'Ketchup', icon: '🫙', group: 'basic', aka: ['tomato ketchup'] },
  { key: 'mayonnaise', name: 'Mayonnaise', icon: '🫙', group: 'basic', aka: ['mayo', 'aioli'] },
  { key: 'miso', name: 'Miso', icon: '🫙', group: 'basic' },
  { key: 'mustard', name: 'Mustard', icon: '🫙', group: 'basic', aka: ['dijon', 'wholegrain mustard'] },
  { key: 'salsa', name: 'Salsa', icon: '🫙', group: 'basic' },
  { key: 'soy-sauce', name: 'Soy sauce', icon: '🫙', group: 'basic', aka: ['tamari', 'shoyu'] },
  { key: 'stock', name: 'Stock', icon: '🫙', group: 'basic', aka: ['broth', 'bouillon', 'stock cubes'] },
  { key: 'vinegar', name: 'Vinegar', icon: '🫙', group: 'basic', aka: ['balsamic', 'cider vinegar', 'white vinegar', 'rice vinegar'] },
  { key: 'worcestershire', name: 'Worcestershire sauce', icon: '🫙', group: 'basic' },
  { key: 'yeast', name: 'Yeast', icon: '🧂', group: 'basic', aka: ['dried yeast', 'nutritional yeast'] },
]

const BY_KEY = new Map(FOODS.map((f) => [f.key, f]))
const GROUP_BY_KEY = new Map(FOOD_GROUPS.map((g) => [g.key, g]))

export function foodMeta(key: string | undefined): Food | undefined {
  return key ? BY_KEY.get(key) : undefined
}

export function groupMeta(key: FoodGroupKey): FoodGroup {
  return GROUP_BY_KEY.get(key) ?? { key: 'basic', label: 'Pantry basics', icon: '🧂' }
}

export function foodsInGroup(group: FoodGroupKey): Food[] {
  return FOODS.filter((f) => f.group === group)
}

// ---------------------------------------------------------------------------
// Matching a product name to a food
// ---------------------------------------------------------------------------

/** Spaces at both ends so a term can be tested for whole words, not fragments. */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/**
 * Every searchable phrase, longest first.
 *
 * Length order is what stops "peanut butter" being filed under butter and
 * "sweet potato" under potato: the longer phrase is the more specific claim, so
 * it wins outright rather than by luck of list order.
 */
const TERMS: Array<{ term: string; key: string }> = (() => {
  const all: Array<{ term: string; key: string; derived: boolean }> = []
  for (const food of FOODS) {
    for (const raw of [food.name, ...(food.aka ?? [])]) {
      const term = normalise(raw).trim()
      if (!term) continue
      // Both spellings, so "carrot" finds "Carrots" and "carrots" finds "Carrot".
      const other = term.endsWith('s') ? term.slice(0, -1) : `${term}s`
      if (term.length >= 3) all.push({ term, key: food.key, derived: false })
      if (other.length >= 3) all.push({ term: other, key: food.key, derived: true })
    }
  }

  // A word someone actually wrote down beats one a plural rule invented for it.
  // Without this, "pepper" would belong to bell pepper purely because the
  // vegetables are listed before the spices.
  all.sort((a, b) => b.term.length - a.term.length || Number(a.derived) - Number(b.derived))

  const seen = new Set<string>()
  return all.filter(({ term }) => !seen.has(term) && seen.add(term))
    .map(({ term, key }) => ({ term, key }))
})()

/**
 * Words that mark what a thing *tastes of* rather than what it *is*.
 *
 * "Freeze-dried rice — chicken flavour" is rice. Left alone the plain
 * longest-match rule files it under chicken, because chicken is the longer
 * word, and the result is a bag of rice that never turns up when you ask what
 * grains you have.
 */
const FLAVOUR_MARKERS = /\b(flavou?r|flavou?red|seasoning|seasoned|style)\b/i

/**
 * Drops the flavouring, keeps the food.
 *
 * Only whole segments are discarded — the part between dashes, commas or
 * brackets — because that is how these labels are actually punctuated, and
 * cutting on anything finer would start eating real words. If every segment
 * looks like a flavour note, nothing is dropped: better to match on the whole
 * name than on nothing.
 */
function withoutFlavourNotes(name: string): string {
  const segments = name.split(/[-–—,()/|]+/).map((s) => s.trim()).filter(Boolean)
  if (segments.length < 2) return name
  const kept = segments.filter((s) => !FLAVOUR_MARKERS.test(s))
  return kept.length ? kept.join(' ') : name
}

/**
 * The basic food a product name is an instance of, or undefined when nothing
 * in the library fits.
 *
 * Undefined is a real answer and gets stored as one — a guess that filed
 * "Birthday cake" under wheat would be worse than admitting the library has no
 * entry for it, because a wrong food is invisible while a missing one is not.
 */
export function matchFood(name: string, brand?: string): string | undefined {
  const subject = withoutFlavourNotes(name)
  const haystack = normalise(brand ? `${subject} ${brand}` : subject)
  for (const { term, key } of TERMS) {
    if (haystack.includes(` ${term} `)) return key
  }
  return undefined
}

/**
 * Levenshtein, capped.
 *
 * Bounded because the answer past the cap is never needed — anything that far
 * away isn't a typo, it's a different word — and the bound lets a whole row be
 * abandoned as soon as it can't win.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (row[j] < best) best = row[j]
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

function termsOf(food: Food): string[] {
  return [food.name, ...(food.aka ?? [])].map((t) => t.toLowerCase())
}

/**
 * The foods a search box query should show.
 *
 * Two passes, and the second only runs when the first finds nothing. Typo
 * tolerance is worth having over a couple of hundred names — "brocoli" plainly
 * means broccoli — but it cannot be allowed to pad a query that already worked:
 * "beef" and "beer" are one keystroke apart, and someone who typed beef
 * correctly should not have to look past beer to find it.
 */
export function foodKeysMatching(query: string): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  const literal = FOODS.filter((f) => termsOf(f).some((t) => t.includes(q)))
  if (literal.length) return new Set(literal.map((f) => f.key))
  if (q.length < 4) return new Set()

  // One slip allowed on a short word, two on a longer one.
  const allowed = q.length <= 5 ? 1 : 2
  const near = FOODS.filter((f) => termsOf(f).some((term) =>
    term.split(/\s+/).some((word) =>
      word.length >= 4 && editDistance(q, word, allowed) <= allowed)))
  return new Set(near.map((f) => f.key))
}

// ---------------------------------------------------------------------------
// Form — the same food, kept a different way
// ---------------------------------------------------------------------------

/**
 * Fresh beets, canned beets and freeze-dried beets are one food in three
 * states, and the state is most of what you need to know to decide whether it
 * answers tonight's question.
 */
export type FoodForm = 'fresh' | 'frozen' | 'canned' | 'jarred' | 'dried' | 'pickled' | 'cured' | 'prepared'

export const FORM_LABEL: Record<FoodForm, string> = {
  fresh: 'Fresh', frozen: 'Frozen', canned: 'Canned', jarred: 'Jarred',
  dried: 'Dried', pickled: 'Pickled', cured: 'Cured', prepared: 'Prepared',
}

/** Longest phrase first, for the same reason the food terms are. */
const FORM_WORDS: Array<[FoodForm, string[]]> = [
  // "Ground" is deliberately absent. It reads as dehydrated for a spice and as
  // minced for meat, and mislabelling ground beef as dried beef is a worse
  // error than leaving ground ginger with no badge at all.
  ['dried', ['freeze dried', 'freeze-dried', 'dehydrated', 'sun dried', 'dried', 'powder', 'powdered', 'flakes']],
  ['canned', ['canned', 'tinned', 'tin of', 'can of']],
  ['jarred', ['jarred', 'in a jar', 'preserved']],
  ['pickled', ['pickled', 'pickle', 'pickles', 'fermented']],
  ['cured', ['cured', 'smoked', 'salted', 'jerky', 'salami', 'prosciutto']],
  ['frozen', ['frozen']],
  ['fresh', ['fresh', 'raw']],
  ['prepared', ['cooked', 'roasted', 'leftover', 'leftovers', 'homemade']],
]

/**
 * How this product is kept.
 *
 * The name is asked first because it is the only thing that can tell canned
 * beets apart from freeze-dried ones when both live in the same cupboard.
 * Storage is the fallback and answers the easy half: a freezer makes things
 * frozen, a fridge keeps them fresh. A pantry says nothing on its own — rice
 * and canned peaches share a shelf — so that case returns undefined rather
 * than inventing a form, and the screen simply doesn't show a badge.
 */
export function foodForm(item: Pick<Item, 'name' | 'unit'>, kind?: StorageKind): FoodForm | undefined {
  const haystack = normalise(item.name)
  for (const [form, words] of FORM_WORDS) {
    for (const word of words) {
      if (haystack.includes(` ${normalise(word).trim()} `)) return form
    }
  }
  if (item.unit === 'can') return 'canned'
  if (kind === 'frozen') return 'frozen'
  if (kind === 'chilled' || kind === 'counter') return 'fresh'
  return undefined
}
