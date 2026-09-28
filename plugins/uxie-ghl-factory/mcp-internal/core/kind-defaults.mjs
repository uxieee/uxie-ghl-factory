// Required objects that no heuristic can invent, taken verbatim from GHL's own store and blog
// template nodes (2026-09-09). The three store kinds 500 without `customText` — it carries every
// label the renderer prints and is read unguarded, exactly like two-setp-order's step1/step2.
// `completeExtra` applies these before falling back to a shaped empty, so build_funnel_page can
// emit a working store or blog element instead of a page that answers 500.
//
// 🔴 NOT EVERY EXTRA PROP IS `{value: …}`-WRAPPED. `socialShareStyle` (and `blog_style` /
// `blogPinedPostStyle` on blog-post) are RAW objects. Wrapping socialShareStyle is the single
// cause of the `Cannot read properties of undefined (reading 'bgColor')` 500 that made
// social-share-blog look unbuildable — the sub-keys barely matter, the envelope does. Values
// below are reproduced from the page-builder bundle's own defaults table, GHL's `"sqaure"` typo
// included, because that is what the renderer matches on.
export const KIND_DEFAULT_EXTRA = Object.freeze({
  // 🔴 A video's source lives in videoProperties.value; the generic media empty (a background-image shape) gave a composed
  // video NO source, and the public page showed an empty 16:9 box (knowledge sniffs/funnels-wave17-analytics-2026-09-29/
  // live-tool.video-default.json). The builder's own saved shape (readback.video.json there): playBackControls,
  // leadVideoOptions and checkStep are RAW objects.
  "video": {
    "videoProperties": { "value": { "url": "", "type": "youtube", "autoplay": 0, "controls": 1, "thumbnailURL": "", "embedURL": "", "width": 100,
      "selfHostedVideo": { "id": "", "name": "", "thumbnail": "https://stcdn.leadconnectorhq.com/funnel/img/video.png", "thumbnailName": "Video Thumbnail.png" } } },
    "playBackControls": { "autoplay": false, "allowPlayPause": false, "playBackSpeed": false, "showPendingTime": false, "showProgressBar": true, "showFullScreenToggle": true, "loop": false },
    "leadVideoOptions": { "isLeadGenVideo": false, "isVideoPlayAllowed": false, "timeStamp": 0, "formElement": null },
    "checkStep": { "checkStep": false, "step": {} },
  },
  // 🔴 one-step-order with an empty step1 renders ONLY name + email, yet the public validator still demands a phone
  // (showPhone ?? true) — so no order could ever be submitted ("Make sure that you filled all the details!", nothing sent;
  // knowledge sniffs/funnels-wave15-actions-2026-09-29). The builder's own ONE_STEP_ORDER defaults, verbatim from its
  // element registry (page builder index.e1b163ff.js).
  "one-step-order": {
    "step1": {
      "value": {
        "shippingHeadline": "Shipping",
        "paymentHeadline": "Payment",
        "headline": "Shipping & Your Info",
        "subHeadline": "Upgrade Your Order & Save!",
        "fullName": "Full Name...",
        "companyName": "Company Name..",
        "email": "Email Address...",
        "phone": "Phone Number...",
        "searchAddress": "Search",
        "address": "Street Address...",
        "city": "City Name...",
        "state": "State / Province...",
        "zipCode": "Zip Code...",
        "showPhone": true,
        "fullNameValidation": true,
        "showShipping": true,
        "showCompanyName": "mandatory",
        "itemText": "Item",
        "priceText": "Price",
        "summaryItemText": "Item",
        "summaryPriceText": "amount",
        "btnText": "Complete Order",
        "btnSubText": "",
        "footerText": "* 100% Secure & Safe Payments *",
        "linkText": "Edit Shipping Details",
        "enableMultiProductSelect": true,
        "enableMainProductDescription": false,
        "enableProductDescription": true,
        "showOrderBump": true,
        "enableCouponCodes": true,
        "btnIcon": "fas fa-shopping-cart",
        "stripeLayout": "classic",
        "enablePostalCode": false,
        "enableCountryPicker": false,
        "enableAutoCompleteAddress": true
      }
    },
    "enableMultiProductSelect": {
      "value": true
    },
    "enableMainProductDescription": {
      "value": false
    },
    "enableProductDescription": {
      "value": true
    },
    "showOrderBump": {
      "value": false
    },
    "enableCouponCodes": {
      "value": true
    },
    "termsAndConditions": {
      "value": {
        "isEnabledForStep1": false,
        "isEnabledForStep2": false,
        "step1": "I agree to the <a href=\"https://www.example.com\" target=\"_blank\"> terms and conditions</a>",
        "step2": "I agree to the <a href=\"https://www.example.com\" target=\"_blank\"> terms and conditions</a>"
      }
    },
    "bumpProduct": {
      "value": []
    },
    "stickyContact": {
      "value": false
    },
    "forceContactCreate": {
      "value": false
    },
    "validateEmail": {
      "value": false
    }
  },
  // bl-245 (2026-09-26): blog needs the NEW `blogAuthor` array and a RAW (unwrapped) `blogFilter`;
  // photo-video-gallery reads its layout/heading/info/settings/watermark objects unguarded. Values are
  // the builder's own defaults, proven to render on a sandbox page
  // (knowledge sniffs/funnels-wave3-elements-2026-09-26/fix2.json).
  "blog": {
    "blogAuthor": { "value": [] },
    "blogFilter": { "filter": "by-category" }
  },
  "photo-video-gallery": {
    "sliderList": { "value": [] },
    "galleryHeading": { "value": { "headingText": "", "activeColor": "#000", "fontSize": 40 } },
    "galleryInfo": { "value": { "overlayColor": "#ffffff00", "textColor": "#000000", "toggleTitle": true, "toggleDescription": true, "titleFontsize": 20, "descriptionFontsize": 14 } },
    "galleryLayout": { "value": { "layout": "grid", "columns": 3, "spacing": 8 } },
    "gallerySettings": { "value": { "clickAction": "openImageInPopup", "showTitle": true, "showDescription": true } },
    "galleryWatermark": { "value": { "type": "logo", "text": "", "position": "Top Left", "fontSize": 10 } }
  },
  // upsell: the renderer reads every one of these; productDetails is left EMPTY (bind a real product
  // with extra.productDetails / the funnel step's products) — no account's product is baked in here.
  "upsell": {
    "manageProducts": { "value": "" },
    "typography": { "value": "var(--contentfont)" },
    "featureHeadlineDesktopFontSize": { "value": 16, "unit": "px" },
    "featureHeadlineMobileFontSize": { "value": 14, "unit": "px" },
    "desktopFontSize": { "value": 18, "unit": "px" },
    "mobileFontSize": { "value": 16, "unit": "px" },
    "priceDiscountDesktopFontSize": { "value": 16, "unit": "px" },
    "priceDiscountMobileFontSize": { "value": 14, "unit": "px" },
    "enableShipping": { "value": true },
    "productDetails": {},
    "saleAction": { "value": "go-to-next-funnel-step" },
    "customText": { "value": { "priceColumnHeading": "Price", "quantityColumnHeading": "Quantity", "shippingHeading": "Shipping", "totalColumnHeading": "Total", "subtotalColumnHeading": "Subtotal", "buyNowButtonText": "Buy Now" } },
    "stepPath": { "value": "" },
    "visitWebsite": { "value": { "url": "", "newTab": false } }
  },
  "store-cart": {
    "typography": {
      "value": "var(--contentfont)"
    },
    "featureHeadlineDesktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "priceDiscountDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "priceDiscountMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "customText": {
      "value": {
        "headline": "My cart",
        "subtotalColumnHeading": "Subtotal",
        "totalColumnHeading": "Total",
        "checkoutButtonText": "Checkout",
        "emptyCartText": "Your cart is empty",
        "continueShopping": "Continue Shopping"
      }
    }
  },
  "store-checkout": {
    "step1": {
      "value": {
        "addressLine2": "Address Line 2",
        "showShipping": true,
        "btnIcon": "fas fa-shopping-cart",
        "enablePostalCode": true,
        "enableCountryPicker": false,
        "enableCouponCodes": true,
        "enableBillingAddress": true,
        "fieldOptions": {
          "phoneNumber": "mandatory",
          "address": "mandatory",
          "country": "mandatory",
          "city": "mandatory",
          "zipPostalCode": "mandatory"
        },
        "enableAutoCompleteAddress": true,
        "enableNote": true
      }
    },
    "enableCouponCodes": {
      "value": true
    },
    "typography": {
      "value": "var(--contentfont)"
    },
    "featureHeadlineDesktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 15,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 15,
      "unit": "px"
    },
    "stickyContact": {
      "value": false
    },
    "forceContactCreate": {
      "value": false
    },
    "validateEmail": {
      "value": true
    },
    "saleAction": {
      "value": "go-to-next-funnel-step"
    },
    "stepPath": {
      "value": ""
    },
    "visitWebsite": {
      "value": ""
    },
    "customText": {
      "value": {
        "breadcrumbSection": {
          "step1Label": "Contact & shipping",
          "step2Label": "Payment",
          "continueToPaymentText": "Continue to payment",
          "returnToContactShippingText": "Return to contact & shipping"
        },
        "contactDetailsSection": {
          "headline": "Contact",
          "email": "Email Address"
        },
        "shippingDetailsSection": {
          "headline": "Shipping details",
          "fullName": "Full Name",
          "phoneNumber": "Phone Number",
          "searchBoxPlaceholder": "Search your address",
          "fullAddress": "Full Address",
          "country": "Country",
          "state": "State / Province",
          "cityName": "City Name",
          "zipCode": "Zip Code",
          "notesHeadingLabelText": "Add notes to your order",
          "notesTextBoxPlaceholder": "Add notes about your order or special notes for delivery",
          "shippingMethodsHeadline": "Shipping methods",
          "freeShippingLabelText": "FREE"
        },
        "billingDetailsSection": {
          "headline": "Billing Details",
          "checkboxText": "Billing address same as shipping address"
        },
        "paymentSection": {
          "headline": "Payment",
          "checkoutButtonText": "Make Payment",
          "footerText": "* 100% Secure & Safe Payments *"
        },
        "cartSummarySection": {
          "headline": "Cart summary",
          "editCartButtonText": "Edit Cart",
          "quantityColumnHeading": "Qty",
          "couponHeadline": "Coupon",
          "couponCodePlaceholder": "Enter Coupon Code",
          "applyCouponButtonText": "Apply",
          "subtotalColumnHeading": "Subtotal",
          "discountHeading": "Discount (coupon)",
          "removeCouponButtonText": "Remove",
          "shippingHeading": "Shipping",
          "totalColumnHeading": "Total"
        }
      }
    }
  },
  "store-thank-you": {
    "typography": {
      "value": "var(--contentfont)"
    },
    "featureHeadlineDesktopFontSize": {
      "value": 26,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 20,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "customText": {
      "value": {
        "thankYouSection": {
          "headline": "Thank you",
          "subHeadline": "You’ll receive a confirmation email for your order",
          "shippingAddressHeadline": "Shipping address",
          "billingAddressHeadline": "Billing address",
          "continueShopping": "Continue Shopping"
        },
        "summaryTableSection": {
          "itemColumnHeading": "Item",
          "priceColumnHeading": "Price",
          "quantityColumnHeading": "Qty",
          "subtotalColumnHeading": "Subtotal",
          "discountHeading": "Discount (coupon)",
          "shippingHeading": "Shipping",
          "freeShippingLabelText": "FREE",
          "totalColumnHeading": "Total"
        },
        "downloadButton": {
          "buttonName": "Download",
          "accessURL": "Access URL"
        }
      }
    },
    "downloadDigitalProducts": {
      "value": true
    }
  },
  "blog-content": {
    "blogContentShowOption": {
      "value": [
        "photo",
        "name",
        "description",
        "social"
      ]
    }
  },
  "social-share-blog": {
    "socialShareOption": {
      "value": [
        "mail",
        "facebook",
        "linkedin",
        "twitter",
        "pinterest"
      ]
    },
    "socialShareStyle": {
      "socialIcon": {
        "cornerRadius": 0,
        "displayType": "icon",
        "iconStyle": "sqaure",
        "iconAlign": "center",
        "fontColor": "#000000",
        "fontSize": 12,
        "fontWeight": 300,
        "fontFamily": "var(--headlinefont)",
        "textStyle": "bold",
        "textTransform": "capitalize"
      },
      "labelText": {
        "text": "Share This",
        "fontColor": "#000000",
        "fontSize": 16,
        "fontWeight": 300,
        "fontFamily": "var(--headlinefont)",
        "textStyle": "bold",
        "textTransform": "capitalize"
      },
      "background": {
        "selectedOption": "color",
        "bgColor": "#ffffff",
        "bgImage": ""
      },
      "highlightedShare": {
        "bgColor": "#101828"
      }
    }
  }
});
