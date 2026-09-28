// What the page BUILDER needs on a node to save the page, per element kind — generated, do not hand-edit.
// Source: knowledge sniffs/funnels-wave15-actions-2026-09-29 12-gen-style-fill.mjs over real-style-gap.json and
// real-extra-type-gap.json (GHL's own template nodes, sniffs/funnel-native-elements-2026-09-09, first node's values):
//  - KIND_DEFAULT_STYLES: style keys every real node of the kind carries and the tool's node lacked;
//  - KIND_CONFIG_EXTRA: CONFIG extra props (never content: lists, text, media, menus, links) whose real value has a
//    different type than the tool's shaped empty — urls inside blanked.
// A kind is listed only once the builder-save differential (live-differential.builder-save-kinds*.json) showed a
// tool-composed node of it made the page unsaveable in the builder ("Error while creating page!", nothing sent) while
// it rendered in public. makeLeaf / completeExtra apply these UNDER anything authored.
export const KIND_DEFAULT_STYLES = Object.freeze({
  "store-cart": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
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
    "secondaryColor": {
      "value": "var(--secondary)"
    },
    "buttonTextColor": {
      "value": "var(--white)"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
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
      "value": "bold",
      "desktop": "400"
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
    }
  },
  "store-checkout": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "checkoutHeadlineTextColor": {
      "value": "var(--black)"
    },
    "cartSummaryTextColor": {
      "value": "var(--black)"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "secondaryColor": {
      "value": "var(--secondary)"
    },
    "buttonTextColor": {
      "value": "var(--white)"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": ""
    },
    "billingTextFontFamily": {
      "value": "var(--montserrat)"
    },
    "cartSummaryTextFontFamily": {
      "value": "var(--montserrat)"
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "600"
    },
    "fontWeightSub": {
      "desktop": "600"
    },
    "subscriptionPillTextColor": {
      "value": "#E62E05"
    },
    "subscriptionPillBackgroundColor": {
      "value": "#FFF4ED"
    }
  },
  "store-thank-you": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "checkoutHeadlineTextColor": {
      "value": "var(--black)"
    },
    "shippingTextColor": {
      "value": "var(--black)"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "secondaryColor": {
      "value": "var(--white)"
    },
    "buttonTextColor": {
      "value": "var(--black)"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": ""
    },
    "billingTextFontFamily": {
      "value": "var(--headlinefont)"
    },
    "shippingFontFamily": {
      "value": "var(--headlinefont)"
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    }
  },
  "store-product-detail": {
    "relatedProductsHeadingTextColor": {
      "value": "var(--black)"
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
    "secondaryColor": {
      "value": "var(--secondary)"
    },
    "buttonColor": {
      "value": "transparent"
    },
    "buttonTextColor": {
      "value": "var(--white)"
    },
    "secondaryButtonBorderColor": {
      "value": "var(--secondary)"
    },
    "buttonBorderColor": {
      "value": "transparent"
    },
    "secondaryButtonTextColor": {
      "value": "var(--secondary)"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
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
    "relatedProductsHeadingFontFamily": {
      "value": "var(--headlinefont)"
    },
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "400"
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
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    },
    "writeButtonBgColor": {
      "value": "#EFF4FF"
    },
    "writeButtonColor": {
      "value": "#004EEB"
    }
  },
  "nav-menu": {
    "secondaryColor": {
      "value": "var(--black)"
    },
    "navMenuItemHoverBackgroundColor": {
      "value": "var(--white)"
    },
    "navMenuItemSpacingX": {
      "value": "10",
      "unit": "px"
    },
    "navMenuItemSpacingY": {
      "value": "10",
      "unit": "px"
    },
    "dropdownBackground": {
      "value": "var(--white)"
    },
    "dropdownTextColor": {
      "value": "var(--black)"
    },
    "dropdownHoverColor": {
      "value": "var(--black)"
    },
    "dropdownItemSpacing": {
      "value": 10,
      "unit": "px"
    }
  },
  "nav-menu-v2": {
    "itemPaddingTop": {
      "unit": "px",
      "value": 0
    },
    "itemPaddingBottom": {
      "unit": "px",
      "value": 0
    },
    "itemPaddingLeft": {
      "unit": "px",
      "value": 16
    },
    "itemPaddingRight": {
      "value": 16,
      "unit": "px"
    },
    "itemMarginTop": {
      "unit": "px",
      "value": 0
    },
    "itemMarginBottom": {
      "unit": "px",
      "value": 0
    },
    "itemMarginLeft": {
      "unit": "px",
      "value": 0
    },
    "itemMarginRight": {
      "unit": "px",
      "value": 0
    },
    "navMenuItemSpacingX": {
      "value": 8,
      "unit": "px"
    },
    "navMenuItemSpacingY": {
      "value": 0,
      "unit": "px"
    },
    "navMenuAlign": {
      "value": "center"
    },
    "subMenuAlign": {
      "value": "right"
    },
    "subMenuStyle": {
      "value": "popover"
    },
    "itemBorderColor": {
      "value": "#000000"
    },
    "itemBorderStyle": {
      "value": "solid"
    },
    "itemBorderWidth": {
      "value": 1,
      "unit": "px"
    },
    "itemBorderRadius": {
      "unit": "px",
      "value": 0
    },
    "itemBoxShadow": {
      "value": "none"
    }
  },
  "image-feature": {
    "fontFamily": {
      "value": ""
    },
    "fontWeight": {
      "value": "normal",
      "desktop": "600"
    },
    "featureHeadlineColor": {
      "value": "var(--white)"
    },
    "featureTextColor": {
      "value": "var(--white)"
    },
    "textShadow": {
      "value": "none"
    },
    "lineHeight": {
      "value": 1.6,
      "unit": "em"
    },
    "letterSpacing": {
      "value": "0",
      "unit": "px"
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "textAlign": {
      "value": "left"
    },
    "linkTextColor": {
      "value": "var(--blue)"
    },
    "fontWeightSub": {
      "desktop": "500"
    }
  },
  "faq": {
    "faqOpenTitleTextColor": {
      "value": "var(--color-mcklh5ma)"
    },
    "faqOpenTitleBackgroundColor": {
      "value": "var(--white)"
    },
    "faqDividerColor": {
      "value": "var(--gray)"
    },
    "faqContentTextColor": {
      "value": "var(--color-mckljcbj)"
    },
    "faqOpenBackgroundColor": {
      "value": "var(--white)"
    },
    "faqClosedTitleTextColor": {
      "value": "#111827"
    },
    "faqClosedTitleBackgroundColor": {
      "value": "var(--white)"
    },
    "faqExpandAllButtonTextColor": {
      "value": "#3B82F6"
    },
    "faqExpandAllButtonBorderColor": {
      "value": "#D1D5DB"
    },
    "faqExpandAllButtonBackgroundColor": {
      "value": "var(--transparent)"
    },
    "linkTextColor": {
      "value": "#3B82F6"
    },
    "faqHeadingFontFamily": {
      "value": "var(--open-sans)"
    },
    "faqContentFontFamily": {
      "value": "var(--open-sans)"
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "borderColor": {
      "value": "var(--black)"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": "2",
      "unit": "px"
    }
  },
  "blog": {
    "buttonColor": {
      "value": "var(--transparent)"
    },
    "buttonTextColor": {
      "value": "#6B7280"
    },
    "buttonBorderColor": {
      "value": "#d1d5db"
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "marginRight": {
      "unit": "px",
      "value": 0
    },
    "marginLeft": {
      "unit": "px",
      "value": 0
    },
    "borderColor": {
      "value": "var(--black)"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": "2",
      "unit": "px"
    }
  },
  "store-product-list": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
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
    "sortFilterTextColor": {
      "value": "var(--black)"
    },
    "sortFilterPillColor": {
      "value": "#F2F4F7"
    },
    "subscriptionPillTextColor": {
      "value": "#E62E05"
    },
    "subscriptionPillBackgroundColor": {
      "value": "#FFF4ED"
    },
    "removeAllColor": {
      "value": "#155EEF"
    },
    "borderRadius": {
      "unit": "px",
      "value": 73
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
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
      "value": "bold",
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    },
    "fontWeightExtra": {
      "desktop": "400"
    },
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    }
  },
  "upsell": {
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
    "buttonColor": {
      "value": "#155EEF"
    },
    "buttonBorderColor": {
      "value": "transparent"
    },
    "buttonTextColor": {
      "value": "white"
    },
    "borderRadius": {
      "unit": "px",
      "value": 0
    },
    "borderColor": {
      "value": "#D0D5DD"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 1,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
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
    "paddingTop": {
      "unit": "px",
      "value": 20
    },
    "paddingBottom": {
      "unit": "px",
      "value": 20
    },
    "paddingLeft": {
      "unit": "px",
      "value": 20
    },
    "paddingRight": {
      "value": 20,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    },
    "fontWeightExtra": {
      "desktop": "400"
    }
  },
  "collection-list": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "collectionHeadingTextColor": {
      "value": "var(--black)"
    },
    "collectionNameTextColor": {
      "value": "#000000"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
    },
    "collectionHeadingFontFamily": {
      "value": "var(--headlinefont)"
    },
    "collectionNameFontFamily": {
      "value": "var(--headlinefont)"
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    }
  },
  "featured-products": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "featureHeadlineColor": {
      "value": "var(--black)"
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
    "subscriptionPillTextColor": {
      "value": "#E62E05"
    },
    "subscriptionPillBackgroundColor": {
      "value": "#FFF4ED"
    },
    "borderRadius": {
      "unit": "px",
      "value": 8
    },
    "borderColor": {
      "value": "#000000"
    },
    "borderStyle": {
      "value": "solid"
    },
    "borderWidth": {
      "value": 0,
      "unit": "px"
    },
    "boxShadow": {
      "value": "none"
    },
    "featuredProductsHeadingFontFamily": {
      "value": "var(--headlinefont)"
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
      "value": "bold",
      "desktop": "400"
    },
    "fontWeightSub": {
      "desktop": "400"
    },
    "fontWeightExtra": {
      "desktop": "400"
    },
    "reviewsAndRatingsColor": {
      "value": "#000"
    },
    "reviewsAndRatingsStarColor": {
      "value": "#FDB022"
    }
  },
  "category-navigation": {
    "paddingTop": {
      "unit": "px",
      "value": 10
    },
    "paddingBottom": {
      "unit": "px",
      "value": 10
    },
    "paddingLeft": {
      "unit": "px",
      "value": 10
    },
    "paddingRight": {
      "value": 10,
      "unit": "px"
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "color": {
      "value": "var(--text-color)"
    },
    "secondaryColor": {
      "value": "var(--blue)"
    },
    "lineHeight": {
      "value": 1.3,
      "unit": "em"
    },
    "textTransform": {
      "value": "none"
    },
    "letterSpacing": {
      "value": "0",
      "unit": "px"
    },
    "textAlign": {
      "value": "center"
    },
    "borderColor": {
      "value": "var(--black)"
    },
    "borderWidth": {
      "value": "0px"
    },
    "borderStyle": {
      "value": "none"
    },
    "borderRadius": {
      "value": "0px"
    },
    "backgroundColor": {
      "value": "var(--transparent)"
    },
    "navMenuItemSpacingX": {
      "value": 5,
      "unit": "px"
    },
    "navMenuItemSpacingY": {
      "value": 5,
      "unit": "px"
    },
    "fontWeight": {
      "value": "bold",
      "desktop": "400"
    },
    "boxShadow": {
      "value": "none"
    }
  },
  "blog-subscribe-form": {
    "paddingLeft": {
      "unit": "px",
      "value": 0
    },
    "paddingRight": {
      "value": 0,
      "unit": "px"
    },
    "paddingTop": {
      "unit": "px",
      "value": 0
    },
    "paddingBottom": {
      "unit": "px",
      "value": 0
    },
    "marginTop": {
      "unit": "px",
      "value": 0
    },
    "marginBottom": {
      "unit": "px",
      "value": 0
    },
    "marginRight": {
      "unit": "px",
      "value": 0
    },
    "marginLeft": {
      "unit": "px",
      "value": 0
    },
    "borderColor": {
      "value": "var(--black)"
    },
    "borderWidth": {
      "value": "0px"
    },
    "borderStyle": {
      "value": "none"
    },
    "borderRadius": {
      "value": "0px"
    },
    "boxShadow": {
      "value": "none"
    }
  }
});
export const KIND_CONFIG_EXTRA = Object.freeze({
  "store-checkout": {
    "customText": {
      "value": {
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
          "notesTextBoxPlaceholder": "Add notes about your order or special notes for delivery"
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
  "store-product-detail": {
    "showAddToCartButton": {
      "value": true
    },
    "showBuyNowButton": {
      "value": true
    },
    "showReviewsAndRatings": {
      "value": true
    },
    "showRatingsCount": {
      "value": true
    },
    "featureHeadline": {},
    "desktopColumns": {
      "value": 3
    },
    "mobileColumns": {
      "value": 2
    },
    "subText": {},
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
    "customText": {
      "value": {
        "productDetailSection": {
          "addToCartButtonText": "Add to Cart",
          "buyNowButtonText": "Buy now",
          "relatedProductsHeading": "You may also like",
          "quantityLabelText": "Quantity"
        },
        "reviewsAndRatingsSection": {
          "oneReviewCountText": "review",
          "multipleReviewsCountText": "reviews",
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
        },
        "cartDetailsDrawer": {
          "itemsAddedHeadline": "item(s) added",
          "viewCartButtonText": "View Cart",
          "continueShopping": "Continue Shopping",
          "cartEmptyHeadline": "Your cart is empty",
          "cartEmptySubHeadline": "Add items to your cart to continue shopping",
          "outOfStockText": "Out of Stock"
        }
      }
    }
  },
  "nav-menu": {
    "mobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 14,
      "unit": "px"
    },
    "icon": {
      "value": {
        "name": "bars",
        "unicode": "f0c9",
        "fontFamily": "Font Awesome 5 Free",
        "color": "var(--black)"
      }
    },
    "visitWebsite": {
      "value": {
        "url": "",
        "newTab": false
      }
    },
    "showSearchbar": {
      "value": true
    }
  },
  "nav-menu-v2": {
    "visitWebsite": {
      "value": {
        "url": "",
        "newTab": false
      }
    },
    "scrollToElement": {
      "value": ""
    },
    "phoneNumber": {
      "value": ""
    },
    "emailAddress": {
      "value": ""
    },
    "stepPath": {
      "value": ""
    },
    "icon": {
      "value": {
        "name": "bars",
        "unicode": "f0c9",
        "fontFamily": "Font Awesome 5 Free",
        "color": "var(--black)"
      }
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "showCartIcon": {
      "value": true
    },
    "showSearchbar": {
      "value": true
    },
    "iconEnd": {
      "value": {
        "name": "",
        "unicode": "",
        "fontFamily": "",
        "color": ""
      }
    }
  },
  "image-feature": {
    "visitWebsite": {
      "value": {
        "url": "",
        "newTab": false
      }
    },
    "featureHeadlineDesktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 18,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 14,
      "unit": "px"
    },
    "featureImageBorder": {
      "value": "img-border-none"
    },
    "featureImageRadius": {
      "value": "img-round-corners"
    },
    "featureImageEffects": {
      "value": "img-effects-none"
    },
    "elementVersion": {
      "value": 2
    }
  },
  "faq": {
    "faqCustomOptions": {
      "value": {
        "openIcon": {
          "color": "var(--black)",
          "fontFamily": "Font Awesome 5 Free",
          "name": "chevron-down",
          "unicode": "f078"
        },
        "closeIcon": {
          "color": "var(--black)",
          "fontFamily": "Font Awesome 5 Free",
          "name": "chevron-up",
          "unicode": "f077"
        },
        "iconPosition": "right",
        "lineHeight": "1.5",
        "showImagePopup": false,
        "expandAllToggle": false,
        "expandAll": false,
        "firstItemOpen": true
      }
    },
    "featureHeadlineDesktopFontSize": {
      "value": 20,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 18,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    }
  },
  "blog": {
    "paginationOverride": {
      "value": 3,
      "min": 0,
      "max": 500
    },
    "compression": {
      "value": true
    }
  },
  "store-product-list": {
    "featureHeadlineDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "enableSorting": {
      "value": true
    },
    "enableFiltering": {
      "value": true
    },
    "filterByAvailability": {
      "value": true
    },
    "filterByPrice": {
      "value": true
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
    "showReviewsAndRatings": {
      "value": true
    },
    "showRatingsCount": {
      "value": true
    },
    "desktopColumns": {
      "value": 4
    },
    "customText": {
      "value": {
        "sortAndFilterSection": {
          "filterHeadline": "Filter: ",
          "availabilityFilterText": "Availability",
          "selectedCountText": "selected",
          "inStockOptionText": "In Stock",
          "outOfStockOptionText": "Out of Stock",
          "resetText": "Reset",
          "removeAllText": "Remove all",
          "priceFilterText": "Price",
          "fromPriceText": "From",
          "toPriceText": "To",
          "sortHeadline": "Sort",
          "featured": "Featured",
          "dateOldToNew": "Date, Old to New",
          "dateNewToOld": "Date, New to Old",
          "alphabeticalAscending": "Alphabetical, A-Z",
          "alphabeticalDescending": "Alphabetical, Z-A",
          "priceLowToHigh": "Price, Low to High",
          "priceHighToLow": "Price, High to Low",
          "productsCountText": "products"
        },
        "productListSection": {
          "previousButtonText": "Previous",
          "nextButtonText": "Next",
          "paginationText": "Page",
          "searchResultsEmptyHeadline": "No results found",
          "searchResultsEmptySubHeadline": "Could not be found. Check the spelling or use a different word or phrase."
        }
      }
    }
  },
  "upsell": {},
  "collection-list": {
    "desktopColumns": {
      "value": 3
    },
    "mobileColumns": {
      "value": 2
    },
    "featureHeadlineDesktopFontSize": {
      "value": 32,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 24,
      "unit": "px"
    },
    "desktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 16,
      "unit": "px"
    }
  },
  "featured-products": {
    "desktopColumns": {
      "value": 3
    },
    "mobileColumns": {
      "value": 2
    },
    "featureHeadlineDesktopFontSize": {
      "value": 32,
      "unit": "px"
    },
    "featureHeadlineMobileFontSize": {
      "value": 24,
      "unit": "px"
    },
    "showReviewsAndRatings": {
      "value": false
    },
    "showRatingsCount": {
      "value": true
    },
    "priceDiscountDesktopFontSize": {
      "value": 16,
      "unit": "px"
    },
    "priceDiscountMobileFontSize": {
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
    }
  },
  "category-navigation": {
    "includeSearchBar": {
      "placeholder": "Search",
      "value": true
    },
    "blogShowHome": {
      "value": true
    },
    "desktopFontSize": {
      "value": 18,
      "unit": "px"
    },
    "mobileFontSize": {
      "value": 18,
      "unit": "px"
    },
    "elementVersion": {
      "value": 2
    }
  },
  "blog-subscribe-form": {
    "blogSubscribeOption": {
      "value": [
        "icon",
        "title",
        "description"
      ],
      "backgroundColor": "#344054"
    },
    "blogSubscribeTags": {
      "value": [
        "New User",
        "Blog"
      ]
    },
    "blogSubscribeFormStyle": {
      "title": {
        "text": "Subscribe to our Mailing List",
        "fontColor": "#ffffff",
        "fontFamily": "var(--headlinefont)",
        "fontSize": 24,
        "fontWeight": "600",
        "textAlign": "left"
      },
      "description": {
        "text": "And that's just a peek at what we offer. Get more marketing tips straight to your inbox.",
        "fontColor": "#ffffff",
        "fontFamily": "var(--headlinefont)",
        "fontSize": 16,
        "fontWeight": "400",
        "textAlign": "left",
        "marginBottom": {
          "unit": "px",
          "value": 20
        }
      },
      "button": {
        "buttonText": "Subscribe Now!",
        "fontColor": "#ffffff",
        "backgroundColor": "#2970FF",
        "fontFamily": "var(--headlinefont)",
        "fontSize": 16,
        "fontWeight": "600",
        "borderRadius": 12,
        "paddingBottom": {
          "unit": "px",
          "value": 10
        },
        "paddingTop": {
          "unit": "px",
          "value": 10
        },
        "paddingLeft": {
          "unit": "px",
          "value": 28
        },
        "paddingRight": {
          "unit": "px",
          "value": 28
        }
      },
      "form": {
        "fontFamily": "var(--headlinefont)",
        "fontSize": 16,
        "fontWeight": "400",
        "textAlign": "left",
        "placeholder": "Enter your Email...",
        "fontColor": "#333333",
        "borderRadius": 12,
        "paddingBottom": {
          "unit": "px",
          "value": 16
        },
        "paddingTop": {
          "unit": "px",
          "value": 16
        },
        "paddingLeft": {
          "unit": "px",
          "value": 20
        },
        "paddingRight": {
          "unit": "px",
          "value": 20
        }
      },
      "background": {
        "selectedOption": "color",
        "bgColor": "#475467",
        "bgImage": ""
      }
    }
  }
});
