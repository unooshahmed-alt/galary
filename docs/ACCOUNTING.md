# Accounting basis

Galary uses **accrual recognition**, and cash movements are tracked separately. Each event is recorded once, in one place.

| Event | Recognised as | Cash recorded in | Never also counted as |
|---|---|---|---|
| Fish sale | Revenue (`fish_sales`) | `customer_receipts` | other income |
| Other income | Revenue (`transactions`, approved) | the transaction's payment status | — |
| Supplier bill | **One** expense row, created when the bill is approved | `bill_payments` (installments) | extra expense per installment |
| Manual expense | Expense (`transactions`, approved) | payment status | — |
| Crew wages | Expense when the payroll is **finalised** (gross) | `crew_payments` | — |
| Owner-funded bonus | Part of crew gross, funded from the owner allocation | `crew_payments` | a deduction from other crew |
| Cash advance | Receivable (not an expense) | paid out on the advance date | wage expense |
| Advance recovery | Reduces the slip's net payable | — | cash received |
| Fish taken by crew | Not a sale; its agreed value is recovered through wages | — | fish sales revenue |

## Formulas

```
Revenue            = recorded fish sales + approved other income
Operating expenses = approved expense transactions (includes approved bills)
Operating profit   = Revenue − Operating expenses
Crew wages         = gross wages of finalised payrolls whose period ends in the range
Fish recovered     = value of fish-taken records deducted in those payrolls
Net profit         = Operating profit − Crew wages + Fish recovered

Outstanding bill   = approved bill total − valid payments applied to it
Supplier credit    = overpaid amounts (recorded with a reason, to be reconciled)
Receivable         = sale total − valid customer receipts
Crew wage liability= net payable on issued slips − valid crew payments
Advance balance    = approved advance − valid recoveries
```

## Wage calculation (per payroll)

```
Base       = chosen basis (gross income | net trip profit [optionally excluding categories] | fixed pool | agreed amount)
Crew pool  = Base × crew share %            (0 when Base ≤ 0)
Shares     = pool split by method, adjusted for attendance if configured, rounded per rule
Owner allocation = Base − crew shares
Bonuses    = from owner allocation only (percentage of it, or fixed); total ≤ owner allocation
Gross      = share + bonus + approved earnings
Deductions = carried-forward balance + approved deductions + fish taken + advances (oldest first; up to available or full)
Net        = max(0, Gross − Deductions); any shortfall becomes a carry-forward adjustment
```

The calculation runs on the server. Its inputs are hashed, and submit, approve and finalise each refuse to continue if any input changed in the meantime. Finalised payrolls keep a snapshot of the rule and inputs. Rule changes always create a new version, so historical wages never move.

## Corrections
Nothing financial is deleted. Use **void** (bills, payments, receipts, transactions, advances, fish taken, adjustments), **reverse** (finalised payroll, if nothing has been paid), **reissue** (a wage slip as a new version) or a **payroll adjustment** for the next period. Each action needs a reason and is written to the audit log.
