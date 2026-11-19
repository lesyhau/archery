# Introduction and Goals

<!-- archery:help
Describes the relevant requirements and the driving forces that software architects and the development team must consider: underlying business goals, essential features and functional requirements, quality goals for the architecture, and relevant stakeholders and their expectations.

See https://docs.arc42.org/section-1/
-->

## Requirements Overview

<!-- archery:help
Contents: Short description of the functional requirements and driving forces; an extract (or abstract) of the requirements. Link to existing requirements documents (with version and location).

Motivation: From the point of view of the end users, a system is created or modified to improve support of a business activity and/or improve the quality.

Form: Short textual description, probably in tabular use-case format. Keep it short; balance readability against redundancy with the requirements documents.
-->

The Webshop lets customers browse the catalogue and **place orders** that are paid through an external payment provider.

- Browse and search products
- Place and pay orders
- Track order status

## Quality Goals

<!-- archery:help
Contents: The top three (max five) quality goals for the architecture whose fulfillment is of highest importance to the major stakeholders. These are quality goals for the architecture, not project goals. Topics: see ISO 25010:2023 or the Q42 quality model (https://quality.arc42.org).

Motivation: Quality goals influence fundamental architectural decisions. Be concrete; avoid buzzwords.

Form: A table with quality goals and concrete scenarios, ordered by priority. Edit data/quality-goals.yaml; link scenarios to goals in data/quality-requirements.yaml.
-->

<!-- archery:table data/quality-goals.yaml -->

## Stakeholders

<!-- archery:help
Contents: Everyone (persons, roles, organizations) who should know the architecture, has to be convinced of it, works with the architecture or the code, needs the documentation for their work, or decides about the system or its development.

Motivation: Unknown stakeholders cause nasty surprises later. Stakeholders determine the extent and level of detail of the documentation.

Form: Table with role/name, contact, and their expectations with respect to the architecture documentation (!) - not their functional or quality requirements. Edit data/stakeholders.yaml.
-->

<!-- archery:table data/stakeholders.yaml -->
