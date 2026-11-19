# Building Block View

<!-- archery:help
Contents: The static decomposition of the system into building blocks (modules, components, subsystems, classes, interfaces, packages, libraries, layers, ...) and their dependencies. Mandatory for every architecture documentation - the "floor plan".

Motivation: Keep an overview of the source code by making its structure understandable through abstraction, without disclosing implementation details.

Form: A hierarchy of white boxes and black boxes. Level 1 is the white box of the overall system with black box descriptions of its building blocks. Level 2 zooms into some level-1 building blocks, and so on.

See https://docs.arc42.org/section-5/
-->

## Whitebox Overall System

<!-- archery:help
Describe the decomposition of the overall system: an overview diagram, a motivation for the decomposition, black box descriptions of the contained building blocks (either one table of name + responsibility, or one black box template per building block as level-3 headings), and optionally important interfaces.

Black box template (one level-3 heading per important building block):
- Purpose/Responsibility
- Interface(s), unless described separately; may include quality and performance characteristics
- (Optional) quality/performance characteristics, e.g. availability, run time behavior
- (Optional) directory/file location
- (Optional) fulfilled requirements, if you need traceability
- (Optional) open issues/problems/risks
-->

<!-- archery:diagram diagrams/building-blocks-l1.uml.json -->

**Motivation**

**Contained Building Blocks**

| Name | Responsibility |
|---|---|
| *<black box 1>* | *<responsibility>* |

**Important Interfaces**

## Level 2

<!-- archery:help
Specify the inner structure of (some) level-1 building blocks as white boxes, one level-3 heading "White Box <building block>" each. Prefer relevance over completeness: describe important, surprising, risky, complex or volatile building blocks; leave out normal, simple or standardized parts.
-->

### White Box Order Service

<!-- archery:diagram diagrams/order-service-internals.uml.json -->

The validator checks each order before it is stored; the store is the shared order repository.

## Level 3

<!-- archery:help
Specify the inner structure of (some) level-2 building blocks as white boxes. Copy this part for further levels if needed.
-->

### White Box *<building block x.1>*

| A | C | B |
|---|---|---|
| 1 | adas | adasd |
| dasdasdasdd |   |   |
