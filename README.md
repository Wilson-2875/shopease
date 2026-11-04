# ShopEase - full-stack e-commerce store

Node.js + Express + MySQL back end, plain HTML/CSS/JavaScript front end (ES modules, no build step).
Built from your earlier cart project: the product data, delivery options, `cart.js` and `money.js` were reused and improved.

## What is included

| Area | What you get |
|---|---|
| Storefront | Responsive layout, category menu, search, filters (category, price, brand, rating, stock, sale), sorting, pagination |
| Catalog | Products with images, descriptions, prices, discounts, categories and sub-categories |
| Cart | Add/remove, change quantity, live totals. Prices are always re-read from the database |
| Accounts | Register, sign in/out, profile, change password, saved addresses, order history, wishlist |
| Checkout | Address, delivery option, coupon, card, M-Pesa, PayPal, bank transfer |
| Orders | Confirmation, status timeline, tracking number, history, customer cancel, email updates |
| Support | Contact form, FAQ, rule-based chat helper |
| Reviews | Ratings and reviews (one per customer per product), "verified purchase" badge |
| Admin | Dashboard, sales report with CSV export, products and stock, categories, orders, customers, coupons, support inbox, newsletter |
| Marketing | Coupons, wishlists, newsletter, "picked for you" and "customers also bought" |
| Security | bcrypt passwords, httpOnly JWT cookie, Helmet headers + CSP, rate limiting, parameterised SQL, server-side pricing, upload checks, CSRF origin check |

## 1. Folder layout in VS Code

```
shopease/
├── .vscode/                  VS Code settings, recommended extensions, debug config
├── database/
│   ├── schema.sql            all tables
│   └── seed.sql              categories, delivery options, coupons, 34 sample products
├── server/
│   ├── app.js                starts Express
│   ├── config/               env.js (settings), db.js (MySQL pool + transactions)
│   ├── middleware/           auth.js (login cookie, roles), errorHandler.js
│   ├── routes/               one file per area: auth, products, orders, payments, admin ...
│   ├── services/             orderService.js, paymentService.js, emailService.js
│   ├── utils/                validation helpers
│   └── scripts/              setupDb.js, createAdmin.js
├── public/                   everything the browser loads
│   ├── *.html                one page per screen
│   ├── css/styles.css        colours are variables at the top
│   ├── js/                   one script per page + shared api.js, cart.js, money.js, ui.js
│   ├── images/               put your product images in images/products/
│   └── uploads/              admin-uploaded product images
├── .env.example              copy to .env
└── package.json
```

Open the **shopease** folder in VS Code (File > Open Folder), accept the extension recommendations, and use the integrated terminal (Ctrl+`).

## 2. Requirements

- **Node.js 18.12 or newer** (20 LTS recommended). Check with `node -v`.
- **MySQL 8.0 or newer** (MySQL Server, or XAMPP/WAMP with MySQL 8).

## 3. Set up MySQL

Option A - automatic (recommended):

1. Make sure MySQL is running and you know the user and password.
2. Copy `.env.example` to `.env` and set `DB_USER` and `DB_PASSWORD`.
3. Run `npm run db:setup`. It creates the `shopease` database, all tables and the sample data. It is safe to run again; `npm run db:reset` drops and rebuilds everything.

Option B - manual (MySQL Workbench or the command line):

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

In Workbench: File > Open SQL Script > `schema.sql` > run (lightning icon), then the same for `seed.sql`.

Tip: install the "MySQL" extension by cweijan from the recommendations to browse tables inside VS Code.

## 4. Run the project

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# edit .env: DB_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run db:setup
npm run db:admin            # creates your admin account from the ADMIN_* values
npm run dev                 # restarts automatically when you edit code
```

Open http://localhost:3000. Sign in at `/login.html` with the admin email and password, then open **Admin** in the menu.
Generate a strong `JWT_SECRET` with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### Product images

The sample products point at `images/products/...` (the same file names as your old project). Copy your old `images/products` folder into `public/images/products/`. Missing images fall back to a grey placeholder, so nothing breaks.

## 5. Payments

`PAYMENT_MODE=simulator` (default) uses a built-in fake gateway so you can test the whole flow with no accounts:

- Card: `4242 4242 4242 4242`, any future expiry, any 3 digits. `4000 0000 0000 0002` is declined. Card numbers are checked in memory and only the last 4 digits are stored.
- M-Pesa and PayPal: approved immediately. Bank transfer: stays "pending" until an admin clicks **Mark as paid**.

`PAYMENT_MODE=live` switches to real providers. **These integrations are written to each provider's documented API but could not be tested against their servers while building, so test each one in its sandbox first.**

| Method | Live behaviour | What you need |
|---|---|---|
| Card | Redirects to Stripe Checkout (hosted page, card data never touches your server). A webhook marks the order paid | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook URL `APP_URL/api/payments/stripe/webhook` for `checkout.session.completed` |
| M-Pesa | STK Push prompt on the customer's phone; Safaricom calls back to confirm | Daraja app keys, shortcode, passkey; `APP_URL` must be a public HTTPS address (use ngrok while developing) |
| PayPal | Redirects to PayPal, captures on return | Client ID and secret. PayPal does not support every currency: set `PAYPAL_CURRENCY` and `PAYPAL_RATE` |
| Bank transfer | Shows `BANK_DETAILS`, admin confirms manually | Nothing |

Use `PAYMENT_METHODS` in `.env` to show only the methods you offer.

## 6. Email

Without `SMTP_HOST`, emails are printed in the terminal. Add SMTP details (Gmail app password, Mailgun, Brevo, ...) to send real order confirmations, status updates and newsletters.

## 7. API overview

`/api/auth/*`, `/api/products`, `/api/categories`, `/api/orders` (+ `/quote`), `/api/payments/*` (provider callbacks), `/api/reviews`, `/api/wishlist`, `/api/addresses`, `/api/support`, `/api/newsletter`, and `/api/admin/*` (admin role only). The REST Client extension can call these from a `.http` file.

## 8. What changed from the old project

- `cart.js`: now validates quantities (a string from an input used to break the totals), survives corrupt storage, and the header badge function is `renderCartQuantity`.
- `money.js`: `calculatePercentChange` returns a number; `formatMoney` added.
- `products.js` data moved to MySQL. `dropPricePercent` is no longer stored; the percentage is calculated from `price` and `previous_price`, so the two can't disagree. Product 1 (socks) had a "-50%" label but its previous price was lower than its price, so the seed uses 3000 as the previous price. Invalid star ratings (above 5) were seeded as "no rating". Brands are placeholders.
- `deliveryOptions.js` became the `delivery_options` table. Delivery is now chosen once per order.

## 9. Before going live

- Set `NODE_ENV=production`, a long random `JWT_SECRET`, and serve over HTTPS (Nginx/Caddy, or a host that provides it). Set `TRUST_PROXY=1` behind a proxy.
- Use a dedicated MySQL user with only the rights it needs instead of `root`.
- Change the admin password after the first login; switch `PAYMENT_MODE=live` only after testing each provider.
- Have the privacy policy and return policy text reviewed for your country.
- Back up the database regularly (`mysqldump`).

## 10. Known limits

No password-reset email flow, no automatic refunds (cancelling a paid order marks it "refunded" but you refund in the provider's dashboard), the chat helper is keyword-based, and there are no automated tests yet.
