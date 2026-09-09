---
surface: funnels
layer: 30-types
title: Choose an element — what a brief asks for, and which kind answers it
status: proven-live
last_verified: 2026-09-09
generated: scripts/build-element-chooser.mjs — the INTENT column is hand-written, every other column is from _data/elements.json
related: [funnels/30-types/native-elements.md, funnels/30-types/synthesis-contract.md]
---

# Choose an element

The corpus proves how to build a page and never said which element to reach for. This is that map.

🔴 **Do not choose by GHL's palette group.** `calendar` and `pricing-table` are filed under
`customHtml`; `faq` and `testimonial` under `mediaElements`. The groups describe how the builder
renders a kind, not what anyone wants it for — an agent building a booking page would never look
in "custom HTML". The registry's `aliases` mislead the same way: the last alias of every kind is
its palette group with "Elements" stripped, so nine unrelated kinds all alias `custom`.

**Columns.** *Binds to* names the references a kind carries, and they are NOT alike:
🔴 = an **account object** (a clone leaves it pointing at the SOURCE account and it fails silently
with the right name beside the wrong id — rule 26); ⚠️ = **page-local** (must resolve inside this
page's own `popupsList`, so an account-wide check is meaningless); unmarked = a **sentinel** value,
not an id. *Needs step type* means the element only renders on
a step of that type. *Donor* is how many real nodes of this kind were seen
across 40 stock template pages — a high count means copying one is easy, `—` means no donor exists
anywhere and you must synthesise it from the registry.

## Say something

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| the headline | `heading` | — | — | ✅ 329 |
| a supporting line under the headline | `sub-heading` | — | — | ✅ 114 |
| body copy | `paragraph` | — | — | ✅ 683 |
| a list of points | `bulletList` | — | — | ✅ 37 |
| copy with mixed formatting or inline links *(new)* | `rich-text` | — | — | — |

## Get them to act

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| a button | `button` | 🔴`productId` 🔴`storeProductId` `storeProductPriceId` 🔴`storeCollectionId` ⚠️`popupId` | — | ✅ 222 |
| capture a lead (name/email/phone) | `form` | 🔴`formId` | — | ✅ 16 |
| ask a series of questions | `survey` | 🔴`surveyId` | — | — |
| let them book a call | `calendar` | 🔴`calendarId` | — | ✅ 4 |
| take payment on this page | `one-step-order` | — | — | — |
| take payment across two steps | `two-setp-order` | — | — | ✅ 18 |
| confirm what they just bought | `order-confirmation` | — | — | — |
| offer an add-on after the purchase | `upsell` | — | — | ✅ 1 |

## Show proof

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| a customer quote or case study *(new)* | `testimonial` | — | — | ✅ 1 |
| client or press logos *(new)* | `logo-showcase` | — | — | — |
| star reviews | `review-widget` | — | — | — |
| a headline number or stat *(new)* | `number-counter` | — | — | — |

## Show something

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| one image | `image` | ⚠️`popupId` | — | ✅ 356 |
| a gallery of images or video | `photo-video-gallery` | — | — | — |
| a carousel | `image-slider` | — | — | — |
| a video | `video` | — | — | ✅ 4 |
| an image beside its own copy | `image-feature` | ⚠️`popupId` | — | ✅ 6 |
| an icon or vector | `svg` | ⚠️`popupId` | — | — |
| where the business is | `map` | — | — | — |
| something to scan on a phone *(new)* | `qr-code` | — | — | — |

## Explain and structure

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| answer common objections | `faq` | — | — | ✅ 15 |
| show prices, plans or tiers *(new)* | `pricing-table` | — | — | — |
| separate two sections | `divider` | — | — | ✅ 7 |
| show how far through a process they are | `progress-bar` | — | — | — |

## Navigate

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| the site menu *(owns children, new)* | `nav-menu-v2` | ⚠️`popupId` | — | ✅ 33 |
| the site menu (older kind — prefer nav-menu-v2) | `nav-menu` | — | — | ✅ 7 |
| a cart icon in the header | `nav-cart` | — | — | — |
| let them search the store | `searchbar` | — | — | ✅ 2 |
| links to social profiles | `social-icons` | — | — | ✅ 9 |

## Create urgency

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| count down to a fixed date | `countdown` | 🔴`countdownTimerId` | — | ✅ 1 |
| count down from when they landed | `minute-timer` | — | — | — |
| count down over days | `day-timer` | — | — | — |
| an evergreen campaign countdown | `marketing-countdown` | 🔴`countdownTimerId` | — | — |

## Blog

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| list the posts | `blog` | — | — | ✅ 1 |
| the body of one post | `blog-content` | — | `blog-post in a type:"blog" funnel` | — |
| browse by category | `category-navigation` | — | — | — |
| let readers share a post | `social-share-blog` | — | — | — |
| feature one post | `blog-pined-post` | — | — | — |
| collect subscribers | `blog-subscribe-form` | — | — | — |

## Store

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| a grid of products | `featured-products` | — | — | ✅ 1 |
| one product in detail | `featured-product` | — | — | — |
| browse collections | `collection-list` | — | — | ✅ 1 |
| the cart page *(protected)* | `store-cart` | — | `store` | ✅ 1 |
| the checkout page *(protected)* | `store-checkout` | — | `store` | ✅ 1 |
| the post-purchase page *(protected)* | `store-thank-you` | — | `store` | ✅ 1 |
| the product list page *(protected)* | `store-product-list` | — | `store` | ✅ 1 |
| the product detail page *(protected)* | `store-product-detail` | — | `store` | ✅ 1 |
| a bespoke product detail page *(protected)* | `store-custom-product-detail` | — | `store` | — |

## Nothing above fits

| the brief says | kind | binds to | needs step type | donor |
|---|---|---|---|---|
| arbitrary markup, full bleed | `custom-code` | — | — | — |

## Every binding on this surface

These nine props are the whole reference surface. Each one clones the way `formId` does — the id is
never remapped — so each is a candidate for the same silent failure. Audit all of them, not just forms.

| prop | kinds that carry it |
|---|---|
| `calendarId` | `calendar` |
| `countdownTimerId` | `countdown`, `marketing-countdown` |
| `formId` | `form` |
| `popupId` | `button`, `image`, `nav-menu-v2`, `svg`, `image-feature` |
| `productId` | `button` |
| `storeCollectionId` | `button` |
| `storeProductId` | `button` |
| `storeProductPriceId` | `button` |
| `surveyId` | `survey` |

