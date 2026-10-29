import { plural } from "./copy";
﻿import { confirmAction, Banner } from "./feedback";
import React from "react";
import { Database, str } from "./model";
import * as svc from "./service";
import {
  defaultSubscriptionConfig,
  simulationNow,
  subscriptionState,
  DAY,
  pendingFacility,
} from "./subscription-model";
import {
  Button,
  Card,
  DataView,
  ErrorBox,
  Form,
  Heading,
  Operation,
  go,
} from "./ui";
export function SubscriptionCard({ db }: { db: Database }) {
  if (!svc.can(db, "subscription")) return null;
  const { h } = svc.context(db);
  const sub = db.subscriptions?.[h.id];
  if (!sub?.trialStart && !sub?.periodEnd) return null;
  const end = sub.periodEnd ?? sub.trialEnd!;
  const days = Math.max(0, Math.ceil((end - simulationNow(db)) / DAY));
  const state = subscriptionState(db, sub);
  return (
    <section
      className={
        "subscription-card " + (days <= 3 ? "subscription-urgent" : "")
      }
      aria-label="Facility subscription"
    >
      <div>
        <p className="eyebrow">
          {sub.periodEnd ? "Facility subscription" : "Your free trial"}
        </p>
        <h2>
          {state === "grace_period"
            ? "Grace period"
            : state === "expired"
              ? "Access is read-only"
              : state === "cancelled"
                ? "Subscription cancelled"
                : plural(days, "day") + " remaining"}
        </h2>
        <p>
          {sub.periodEnd ? "Renewal" : "Trial ends"}:{" "}
          {new Date(end).toLocaleDateString("en-NG", {
            timeZone: "Africa/Lagos",
          })}
          {state === "grace_period" &&
            " · Grace ends " +
              new Date(end + sub.graceDays * DAY).toLocaleDateString("en-NG", {
                timeZone: "Africa/Lagos",
              })}
        </p>
      </div>
      <Button onClick={() => go("/subscription")}>Choose a plan</Button>
    </section>
  );
}
export function SubscriptionPage({ db }: { db: Database }) {
  if (!svc.can(db, "subscription"))
    return <ErrorBox message="This page is unavailable for your role." />;
  const { h } = svc.context(db);
  const sub = db.subscriptions?.[h.id];
  return (
    <>
      <Heading
        title="Facility subscription"
        sub="Separate from patient billing"
      />
      <p>
        Local subscription simulation. No real payment is collected. Pricing and
        payment provider integration are not configured.
      </p>
      <SubscriptionCard db={db} />
      <Card>
        <h2>Current plan</h2>
        {sub ? (
          <DataView
            data={{
              plan: sub.plan,
              status: sub.trialStart
                ? subscriptionState(db, sub)
                : "Awaiting facility verification",
              trialStart: sub.trialStart
                ? new Date(sub.trialStart).toISOString()
                : "Not started",
              trialEnd: sub.trialEnd
                ? new Date(sub.trialEnd).toISOString()
                : "Not started",
              renewalDate: sub.periodEnd
                ? new Date(sub.periodEnd).toISOString()
                : "Not scheduled",
              graceDays: sub.graceDays,
            }}
          />
        ) : (
          <p>
            This existing demonstration facility has no subscription configured.
          </p>
        )}
      </Card>
      <Card>
        <h2>Demo facility plan</h2>
        <p>
          Price: not set. This is a configurable demonstration, not a commercial
          offer. Each simulated renewal extends access by{" "}
          {(db.subscriptionConfig || defaultSubscriptionConfig).renewalDays}{" "}
          days.
        </p>
        {pendingFacility(h) ? (
          <p>Facility verification is required before choosing a plan.</p>
        ) : (
          <Operation
            onClick={async () => {
              if (
                !(await confirmAction({
                  title: "Apply the demonstration plan?",
                  body: "This is a local simulation. No payment will be taken.",
                  action: "Apply demonstration plan",
                }))
              )
                return false;
              await svc.renewSubscription("Demo facility plan");
            }}
          >
            Simulate subscription / renewal — no charge
          </Operation>
        )}
        {sub && sub.status !== "cancelled" && (
          <Operation
            secondary
            onClick={async () => {
              if (
                await confirmAction({
                  title: "Cancel this subscription?",
                  body: "Existing records remain readable. New clinical entries will be unavailable.",
                  action: "Cancel subscription",
                  word: "CANCEL",
                })
              )
                await svc.cancelSubscription();
            }}
          >
            Cancel simulated subscription
          </Operation>
        )}
      </Card>
      <Card>
        <h2>Renewal reminders</h2>
        {db.subscriptionReminders?.length ? (
          db.subscriptionReminders.map((r) => (
            <p key={r.id}>
              Reminder at {r.days} days before{" "}
              {new Date(r.end).toLocaleDateString("en-NG", {
                timeZone: "Africa/Lagos",
              })}
              . Recorded {new Date(r.createdAt).toLocaleString()}.
            </p>
          ))
        ) : (
          <p>No renewal reminders yet.</p>
        )}
        <p>
          Only authorized subscription roles receive these in-app reminders.
          Email and SMS are not connected.
        </p>
      </Card>
      <Card>
        <h2>Subscription history</h2>
        {sub?.history.map((event, i) => (
          <p key={i}>
            {new Date(event.at).toLocaleString()} · {event.action}
          </p>
        ))}
      </Card>
    </>
  );
}
export function SubscriptionSimulation({ db }: { db: Database }) {
  const config = db.subscriptionConfig || defaultSubscriptionConfig;
  return (
    <Card>
      <h2>Subscription & verification simulation</h2>
      <p>
        Development controls use fictional records and a local simulated clock.
        They are not a payment service or independent facility verification.
      </p>
      <p>
        Simulation date:{" "}
        {new Date(simulationNow(db)).toLocaleString("en-NG", {
          timeZone: "Africa/Lagos",
        })}
      </p>
      <div className="actions">
        {[1, 7, 21].map((days) => (
          <Operation
            key={days}
            secondary
            onClick={() => svc.advanceSimulationDays(days)}
          >
            Advance {days} days
          </Operation>
        ))}
      </div>
      <Form
        fields={[
          {
            key: "trialDays",
            label: "Trial days",
            type: "number",
            required: true,
          },
          {
            key: "graceDays",
            label: "Grace days",
            type: "number",
            required: true,
          },
          {
            key: "renewalDays",
            label: "Demo renewal days",
            type: "number",
            required: true,
          },
          {
            key: "reminderDays",
            label: "Reminder intervals (comma-separated days)",
            required: true,
          },
          {
            key: "provider",
            label: "Unconnected provider reference",
            required: true,
          },
        ]}
        initial={{ ...config, reminderDays: config.reminderDays.join(",") }}
        label="Save simulation policy"
        onSubmit={(values) => svc.configureSubscriptionSimulation(values)}
      />
      <p>
        Changes apply to new trials/renewals. Existing trial end dates are
        preserved.
      </p>
      {db.hospitals
        .filter((h) => h.registrationProfile)
        .map((h) => (
          <details key={h.id}>
            <summary>
              {h.name} · {h.verification.replaceAll("_", " ")}
            </summary>
            <Form
              fields={[
                {
                  key: "status",
                  label: "Simulated verification outcome",
                  options: [
                    "pending_verification",
                    "verified",
                    "rejected",
                    "suspended",
                  ],
                  required: true,
                },
                {
                  key: "reason",
                  label: "Review reason",
                  type: "textarea",
                  required: true,
                },
              ]}
              label="Apply fictional review"
              onSubmit={(data) =>
                svc.simulateFacilityReview(
                  h.id,
                  str(data.status),
                  str(data.reason),
                )
              }
            />
          </details>
        ))}
    </Card>
  );
}
