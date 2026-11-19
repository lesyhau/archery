# Context and Scope

<!-- archery:help
Contents: Delimits your system (its scope) from all its communication partners (neighboring systems and users, i.e. its context), thereby specifying the external interfaces. If necessary, differentiate the business context (domain-specific inputs and outputs) from the technical context (channels, protocols, hardware).

Motivation: The domain and technical interfaces to communication partners are among the most critical aspects of the system.

Form: Context diagrams and/or lists of communication partners and their interfaces.

See https://docs.arc42.org/section-3/
-->

## Business Context

<!-- archery:help
Contents: All communication partners (users, IT systems, ...) with explanations of domain-specific inputs and outputs or interfaces; optionally domain-specific formats or protocols.

Form: Diagrams that show the system as a black box with its domain interfaces, and/or a table: communication partner | inputs | outputs.
-->

Customers place orders; paying is part of it, and a declined card can be retried:

<!-- archery:diagram diagrams/shopping-use-cases.uml.json -->

## Technical Context

<!-- archery:help
Contents: Technical interfaces (channels and transmission media) linking the system to its environment, plus a mapping of domain-specific input/output to the channels.

Form: E.g. a UML deployment diagram describing channels to neighboring systems, with a mapping table between channels and input/output.
-->
