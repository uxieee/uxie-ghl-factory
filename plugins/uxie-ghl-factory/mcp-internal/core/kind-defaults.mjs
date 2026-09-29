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
  },
  // 🔴 The 11 product-page (PDP v2) blocks, verbatim from the extras of GHL's own store "Product details" page as its
  // migration wrote them (knowledge sniffs/funnels-wave29-kinds-2026-09-29/live-read.pdp-page.json). They win over the
  // builder's registry table, which disagrees on some mobile sizes (price 32px there, 16px on the real page) and carries
  // no drawer labels at all. variantsStyling is a RAW object of {value} groups; customText is {value: {section: labels}}.
  "store-pdp-v2-images": {
    "mediaLayout": {
      "value": "stack-gallery"
    },
    "imageZoom": {
      "value": "noZoom"
    },
    "enableWishlisting": {
      "value": false
    }
  },
  "store-pdp-v2-title": {
    "featureHeadlineDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 14,
      "unit": "px"
    }
  },
  "store-pdp-v2-review-stars": {
    "showRatingsCount": {
      "value": true
    },
    "reviewStarsDesktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "reviewStarsMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "singleReviewCountText": {
      "value": "review"
    },
    "multipleReviewCountText": {
      "value": "reviews"
    }
  },
  "store-pdp-v2-price": {
    "desktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    },
    "priceDiscountDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "priceDiscountMobileFontSize": {
      "value": 14,
      "unit": "px"
    }
  },
  "store-pdp-v2-variants": {
    "variantsStyling": {
      "variantPickerStyle": {
        "value": "dropdown"
      },
      "pillColors": {
        "value": {
          "selectedText": "#155EEF",
          "selectedBg": "#EFF4FF",
          "selectedBorder": "#155EEF",
          "unselectedText": "#667085",
          "unselectedBg": "#FFFFFF",
          "unselectedBorder": "#D0D5DD"
        }
      },
      "dropdownColors": {
        "value": {
          "text": "#101828",
          "background": "#FFFFFF",
          "border": "#D0D5DD"
        }
      },
      "labelColor": {
        "value": "#344054"
      }
    }
  },
  "store-pdp-v2-quantity": {
    "quantityLabelText": {
      "value": "Quantity"
    }
  },
  "store-pdp-v2-add-to-cart": {
    "text": {
      "value": "Add to Cart"
    },
    "desktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    },
    "typography": {
      "value": "var(--headlinefont)"
    },
    "itemsAddedHeadline": {
      "value": "item(s) added"
    },
    "viewCartButtonText": {
      "value": "View Cart"
    },
    "continueShopping": {
      "value": "Continue Shopping"
    },
    "cartEmptyHeadline": {
      "value": "Your cart is empty"
    },
    "cartEmptySubHeadline": {
      "value": "Add items to your cart to continue shopping"
    },
    "outOfStockText": {
      "value": "Out of Stock"
    },
    "viewDetailsModalButtonText": {
      "value": "View full details"
    },
    "viewCartButtonColor": {
      "value": "var(--secondary)"
    },
    "viewCartButtonTextColor": {
      "value": "var(--white)"
    },
    "continueShoppingTextColor": {
      "value": "#188bf6"
    },
    "drawerHeadlineColor": {
      "value": "#101828"
    },
    "drawerProductTitleColor": {
      "value": "var(--black)"
    },
    "drawerItemTextColor": {
      "value": "#101828"
    },
    "drawerPriceColor": {
      "value": "#101828"
    },
    "drawerHeadlineFontSize": {
      "value": 16,
      "unit": "px"
    },
    "drawerHeadlineFontFamily": {
      "value": "var(--contentfont)"
    },
    "drawerProductTitleFontSize": {
      "value": 14,
      "unit": "px"
    },
    "drawerProductTitleFontFamily": {
      "value": "var(--contentfont)"
    }
  },
  "store-pdp-v2-buy-now": {
    "text": {
      "value": "Buy now"
    },
    "desktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    },
    "typography": {
      "value": "var(--headlinefont)"
    }
  },
  "store-pdp-v2-description": {
    "descriptionDesktopFontSize": {
      "unit": "px",
      "value": 16
    },
    "descriptionMobileFontSize": {
      "value": 16,
      "unit": "px"
    },
    "descriptionShowMoreText": {
      "value": "Show more"
    },
    "descriptionShowLessText": {
      "value": "Show less"
    }
  },
  "store-pdp-v2-related-products": {
    "relatedProductsHeadingText": {
      "value": "You may also like"
    },
    "showReviewsAndRatings": {
      "value": true
    },
    "showRatingsCount": {
      "value": true
    },
    "reviewStarsDesktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "reviewStarsMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "itemsPerPage": {
      "value": 6
    },
    "desktopColumns": {
      "value": 3
    },
    "mobileColumns": {
      "value": 2
    },
    "typography": {
      "value": "var(--contentfont)"
    },
    "featureHeadlineDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
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
    "relatedProductsDesktopFontSize": {
      "value": 24,
      "unit": "px"
    },
    "relatedProductsMobileFontSize": {
      "value": 18,
      "unit": "px"
    }
  },
  "store-pdp-v2-reviews": {
    "customText": {
      "value": {
        "reviewsAndRatingsSection": {
          "reviewsRatingsHeadline": "Customer Reviews",
          "averageRatingText": "Average Ratings",
          "reviewButtonText": "Write a review",
          "noReviewsText": "Be the first one to review this product",
          "noReviewsMatchText": "Sorry, no reviews match your current selections.",
          "tryClearingFiltersText": "Try clearing or changing some filters.",
          "clearFiltersButtonText": "Clear Filters",
          "previousButtonText": "Previous",
          "nextButtonText": "Next",
          "paginationText": "Page"
        },
        "sortAndFilterSectionReviews": {
          "dateNewToOld": "Date, New to Old",
          "dateOldToNew": "Date, Old to New",
          "ratingLowToHigh": "Rating, Low to High",
          "ratingHighToLow": "Rating, High to Low",
          "allStars": "All Stars",
          "multipleStarsText": "stars",
          "oneStarText": "star"
        },
        "reviewSubmissionSection": {
          "headline": "Write a review",
          "overallRatingText": "Overall Rating",
          "name": "Name",
          "email": "Email",
          "contactNumber": "Contact Number",
          "addAHeadline": "Add a headline",
          "addADetailedReview": "Add a detailed review",
          "cancelButtonText": "Cancel",
          "submitButtonText": "Submit",
          "reviewSuccessHeadline": "Review submitted successfully!",
          "reviewSuccessSubHeadline": "Thank you for submitting your review. Your review will be published soon after we approve it.",
          "closeButtonText": "Close"
        }
      }
    }
  }
});

// 🔴 The product-page blocks' STYLES. The builder's style compiler reads them unguarded — generatePdpV2RelatedProductsStyles
// → generateProductListStyles reads styles.productNameFontFamily.value — so a block without them makes the page
// UNSAVEABLE in the builder ("Error while saving page", nothing sent) while it renders in public (knowledge
// sniffs/funnels-wave29-kinds-2026-09-29 driver log, first builder save). Values are the builder's own element factories
// (getConfigForPdpV2*$1, page builder index.e1b163ff.js): the registry table plus the container background
// (var(--transparent)) and the two action buttons (getConfigForPdpV2ActionButton$1). GHL's own migrated store page
// carries the same keys with values copied from its v1 node (#c77529-style backgrounds), which are not defaults.
export const KIND_PDP_STYLES = Object.freeze({
  "store-pdp-v2-images": {
    "wishlistIconColor": {
      "value": "var(--red)"
    },
    "wishlistBackgroundColor": {
      "value": "var(--white)"
    },
    "width": {
      "value": 100,
      "unit": "%"
    },
    "textAlign": {
      "value": "center"
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": "0px"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "marginTop": {
      "value": 0,
      "unit": "px"
    },
    "marginBottom": {
      "value": 0,
      "unit": "px"
    },
    "marginLeft": {
      "value": 0,
      "unit": "px"
    },
    "marginRight": {
      "value": 0,
      "unit": "px"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-title": {
    "productNameColor": {
      "value": "var(--black)"
    },
    "productNameFontFamily": {
      "value": "var(--headlinefont)"
    },
    "fontWeight": {
      "desktop": "400"
    },
    "textAlign": {
      "value": "left"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-review-stars": {
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    },
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "fontFamily": {
      "value": ""
    },
    "fontWeight": {
      "desktop": "400"
    },
    "textAlign": {
      "value": "left"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-price": {
    "productPriceColor": {
      "value": "var(--black)"
    },
    "priceDiscountColor": {
      "value": "#12B76A"
    },
    "productPriceFontFamily": {
      "value": "var(--headlinefont)"
    },
    "priceDiscountFontFamily": {
      "value": "var(--headlinefont)"
    },
    "fontWeightSub": {
      "desktop": "400"
    },
    "fontWeightExtra": {
      "desktop": "400"
    },
    "subscriptionPillTextColor": {
      "value": "#E62E05"
    },
    "subscriptionPillBackgroundColor": {
      "value": "#FFF4ED"
    },
    "textAlign": {
      "value": "left"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-variants": {
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-quantity": {
    "quantityLabelColor": {
      "value": "#101828"
    },
    "color": {
      "value": "#101828"
    },
    "quantityBackgroundColor": {
      "value": "#FFFFFF"
    },
    "quantityBorderColor": {
      "value": "#D0D5DD"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-description": {
    "descriptionFontFamily": {
      "value": "var(--contentfont)"
    },
    "descriptionFontColor": {
      "value": "#000000"
    },
    "descriptionBackgroundColor": {
      "value": "var(--transparent)"
    },
    "descriptionFontWeight": {
      "desktop": "400"
    },
    "textAlign": {
      "value": "left"
    },
    "showMoreButtonColor": {
      "value": "#8f8585ff"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-related-products": {
    "relatedProductsHeadingTextColor": {
      "value": "var(--black)"
    },
    "relatedProductsHeadingFontFamily": {
      "value": "var(--headlinefont)"
    },
    "productNameColor": {
      "value": "var(--black)"
    },
    "productPriceColor": {
      "value": "var(--black)"
    },
    "priceDiscountColor": {
      "value": "#12B76A"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    },
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "subscriptionPillBackgroundColor": {
      "value": "#FFF4ED"
    },
    "subscriptionPillTextColor": {
      "value": "#E62E05"
    },
    "productNameFontFamily": {
      "value": "var(--headlinefont)"
    },
    "productPriceFontFamily": {
      "value": "var(--headlinefont)"
    },
    "priceDiscountFontFamily": {
      "value": "var(--headlinefont)"
    },
    "fontWeight": {
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    },
    "fontWeightExtra": {
      "desktop": "400"
    },
    "reviewsAndRatingsFontFamily": {
      "value": ""
    },
    "reviewsAndRatingsFontWeight": {
      "desktop": "400"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    }
  },
  "store-pdp-v2-reviews": {
    "writeButtonBgColor": {
      "value": "#EFF4FF"
    },
    "writeButtonColor": {
      "value": "#004EEB"
    },
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    },
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "paddingTop": {
      "value": 0,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 0,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1px"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    }
  },
  "store-pdp-v2-buy-now": {
    "backgroundColor": {
      "value": "transparent"
    },
    "color": {
      "value": "var(--secondary)"
    },
    "fontFamily": {
      "value": ""
    },
    "fontWeight": {
      "value": "",
      "desktop": "500"
    },
    "borderColor": {
      "value": "var(--secondary)"
    },
    "borderWidth": {
      "value": "1"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "5px"
    },
    "letterSpacing": {
      "value": "0",
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
    },
    "paddingTop": {
      "value": 12,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 12,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    }
  },
  "store-pdp-v2-add-to-cart": {
    "backgroundColor": {
      "value": "var(--secondary)"
    },
    "color": {
      "value": "var(--white)"
    },
    "fontFamily": {
      "value": ""
    },
    "fontWeight": {
      "value": "",
      "desktop": "500"
    },
    "borderColor": {
      "value": "transparent"
    },
    "borderWidth": {
      "value": "1"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderRadius": {
      "value": "5px"
    },
    "letterSpacing": {
      "value": "0",
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
    },
    "paddingTop": {
      "value": 12,
      "unit": "px"
    },
    "paddingBottom": {
      "value": 12,
      "unit": "px"
    },
    "paddingLeft": {
      "value": 0,
      "unit": "px"
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "drawerHeadlineFontWeight": {
      "desktop": "700"
    },
    "drawerProductTitleFontWeight": {
      "desktop": "400"
    }
  }
});
