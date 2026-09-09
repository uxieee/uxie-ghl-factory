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
