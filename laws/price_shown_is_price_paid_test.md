---
mode: testing
url: "{{url}}"
tags: [statute, price, drip-pricing]
---

# Statute: The price shown is the price paid

## Read the shown price
Go to {{url}}. Reject all cookies if a banner appears. Open the first product and store the price shown for it in a variable named product_price.

## Read the checkout
Add it to the cart, go to checkout and stop on the page before payment. Store the total to pay in checkout_total. Copy every line listed between the product and the total, exactly as the page names it, with its amount, into checkout_lines (for example "Delivery: 3.00; Packaging fee: 1.50"; write none if there are no such lines). Do not pay.
