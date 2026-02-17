# [Project Name] — Business Process Flows

## Document Purpose

This document describes the key business processes and user workflows for [Project Name]. Each flow includes a Mermaid diagram for visual reference and prose description of the business logic.

---

## 1. Platform Overview

### 1.1 User Roles

| Role | Description | Primary Activities |
|------|-------------|-------------------|
| **[Role 1]** | [Description] | [Activities] |
| **[Role 2]** | [Description] | [Activities] |
| **[Role 3]** | [Description] | [Activities] |

---

### 1.2 High-Level System Context

```mermaid
flowchart TB
    subgraph Platform["[Project Name]"]
        M1["[Module 1]"]
        M2["[Module 2]"]
        M3["[Module 3]"]
    end

    subgraph External["External Services"]
        E1["[Service 1]"]
        E2["[Service 2]"]
    end

    subgraph Users["Users"]
        U1["[User Role 1]"]
        U2["[User Role 2]"]
    end

    U1 --> M1
    U1 --> M2
    U2 --> M1

    M2 <--> E1
    Platform --> E2
```

[Describe how the system modules interact with users and external services.]

---

## 2. [Process Name 1]

### 2.1 [Flow Name]

```mermaid
flowchart TD
    A[Step 1] --> B[Step 2]
    B --> C{Decision?}
    C -->|Yes| D[Path A]
    C -->|No| E[Path B]
    D --> F[Outcome]
    E --> F
```

**Process Description:**

1. **[Step 1]:** [Description of what happens]
2. **[Step 2]:** [Description of what happens]
3. **[Decision]:** [Description of the branching logic]

---

## 3. [Process Name 2]

### 3.1 [Flow Name]

```mermaid
flowchart TD
    A[Start] --> B[Action]
    B --> C{Check}
    C -->|Pass| D[Continue]
    C -->|Fail| E[Handle Error]
    E --> B
    D --> F[Complete]
```

**Process Description:**

1. **[Step 1]:** [Description]
2. **[Step 2]:** [Description]

---

## 4. [Entity] Status State Machine

```mermaid
stateDiagram-v2
    [*] --> [State1]: [Trigger]

    [State1] --> [State2]: [Transition condition]
    [State2] --> [State3]: [Transition condition]
    [State3] --> [State2]: [Transition condition]
    [State2] --> [State4]: [Transition condition]

    [State4] --> [*]
```

---

## 5. Data Flow Summary

```mermaid
flowchart LR
    subgraph Input["Data In"]
        I1[Source 1]
        I2[Source 2]
    end

    subgraph Platform["Platform Processing"]
        P1[Processor 1]
        P2[Processor 2]
    end

    subgraph Output["Data Out"]
        O1[Output 1]
        O2[Output 2]
    end

    subgraph Storage["Persistence"]
        S1[(Store 1)]
        S2[(Store 2)]
    end

    I1 --> P1 --> S1
    I2 --> P2 --> S2
    S1 & S2 --> O1 & O2
```

---

## 6. Scheduled Jobs

```mermaid
flowchart LR
    subgraph Jobs["Scheduled Jobs"]
        J1[Job 1]
        J2[Job 2]
    end

    subgraph Triggers["Triggers"]
        T1[Trigger condition 1]
        T2[Trigger condition 2]
    end

    T1 --> J1
    T2 --> J2
```

---

## 7. External Service Integration

```mermaid
flowchart TB
    subgraph Platform["Platform"]
        S1[Service 1]
        S2[Service 2]
    end

    subgraph External1["[External Service 1]"]
        E1A[API]
        E1B[Webhooks]
    end

    subgraph External2["[External Service 2]"]
        E2A[API]
    end

    S1 <--> E1A
    E1B --> S1
    S2 --> E2A
```
