# Runtime View

<!-- archery:help
Contents: Concrete behavior and interactions of the building blocks as scenarios: important use cases or features; interactions at critical external interfaces; operation and administration (launch, start-up, stop); error and exception scenarios. Choose scenarios by architectural relevance - a representative selection, not many.

Motivation: Shows how building block instances do their job and communicate at runtime; helps stakeholders who are less able to read the static views.

Form: Numbered steps, activity diagrams or flow charts, sequence diagrams, BPMN, state machines, ...

See https://docs.arc42.org/section-6/
-->

## Place an order

<!-- archery:diagram diagrams/place-order.seq.json -->

The order service charges the payment gateway synchronously and answers the customer either way.

## Checkout workflow

<!-- archery:diagram diagrams/checkout.uml.json -->

The same scenario as a communication diagram (the numbers show the call nesting):

<!-- archery:diagram diagrams/place-order-communication.seq.json -->

## Order flow

<!-- archery:diagram diagrams/order-flow.uml.json -->

## Place order against the clock

<!-- archery:diagram diagrams/place-order-timing.timing.json -->

The payment gateway must answer within 2 seconds of the charge; the storefront shows a spinner meanwhile.
