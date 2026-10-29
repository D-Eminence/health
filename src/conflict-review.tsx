import React, { useEffect, useState, useRef } from "react";
import {
  ConflictReview,
  getConflictReview,
  resolveConflict,
  retainsReviewAccess,
} from "./conflicts";
import {
  Banner,
  Drawer,
  Skeleton,
  hasUnsaved,
  confirmAction,
} from "./feedback";
import { Button, DataView, ErrorBox, Form } from "./ui";
import { str } from "./model";

export function ConflictReviewDrawer({
  batchId,
  onClose,
  onResolved,
}: {
  batchId: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [review, setReview] = useState<ConflictReview | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [done, setDone] = useState(false);
  const [cacheRefreshed, setCacheRefreshed] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setReview(null);
    setError("");
    setDone(false);
    setCacheRefreshed(true);
    if (batchId)
      void getConflictReview(batchId)
        .then((result) => {
          if (active) setReview(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [batchId, reload]);
  useEffect(() => {
    if (!review) return;
    let active = true;
    const timer = setInterval(() => {
      void retainsReviewAccess(review)
        .then((allowed) => {
          if (active && !allowed) {
            setReview(null);
            setDone(false);
            setError(
              "Your review access changed. Return to your current workspace.",
            );
          }
        })
        .catch(() => {});
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [review]);
  return (
    <Drawer
      open={!!batchId}
      onClose={onClose}
      title="Review conflicting versions"
    >
      <div ref={content}>
        <p>
          Local simulation. A connection and current clinical permissions are
          required.
        </p>
        {error && <ErrorBox message={error} />}
        {!review && !error && <Skeleton />}
        {done ? (
          <Banner title="Review recorded">
            <p>
              The selected versions were saved. Both originals and your decision
              remain in the review history. Later queued edits may still need
              review.
            </p>
            {!cacheRefreshed && (
              <p>
                The review is saved, but the offline copy could not refresh.
                Free device storage and use Sync now before working offline.
              </p>
            )}
            <Button onClick={onClose}>Return to sync details</Button>
          </Banner>
        ) : (
          <>
            <Button
              onClick={async () => {
                if (
                  content.current &&
                  hasUnsaved(content.current) &&
                  !(await confirmAction({
                    title: "Discard this review's unsaved choices?",
                    body: "Reloading fetches the latest versions. The original records remain saved.",
                    action: "Discard choices and reload",
                  }))
                )
                  return;
                setReload((n) => n + 1);
              }}
            >
              Reload versions
            </Button>
            {review && (
              <>
                <Banner title="Compare every record" tone="warning">
                  <p>
                    Choose a complete version for each record and explain the
                    decision. This includes its status. No values are merged
                    automatically. Make any further amendment through the
                    record's normal workflow.
                  </p>
                </Banner>
                {review.records.map((pair, index) => (
                  <section key={pair.local.id} className="record-block">
                    <h3>
                      Record {index + 1}: {pair.local.kind}
                    </h3>
                    <div className="conflict-comparison">
                      <section>
                        <h4>Saved on this device</h4>
                        <p>Status: {pair.local.status}</p>
                        <p>
                          Entered{" "}
                          {new Date(pair.local.updatedAt).toLocaleString()}
                        </p>
                        <DataView data={pair.local.data} />
                      </section>
                      <section>
                        <h4>Connected version</h4>
                        {pair.remote ? (
                          <>
                            <p>Status: {pair.remote.status}</p>
                            <p>
                              Updated{" "}
                              {new Date(pair.remote.updatedAt).toLocaleString()}
                            </p>
                            <DataView data={pair.remote.data} />
                          </>
                        ) : (
                          <p>No connected version exists.</p>
                        )}
                      </section>
                    </div>
                  </section>
                ))}
                <Form
                  key={review.token}
                  fields={[
                    ...review.records.map((pair, i) => ({
                      key: pair.local.id,
                      label: `Record ${i + 1}: version to retain`,
                      required: true,
                      choices: [
                        { value: "local", label: "Saved on this device" },
                        ...(pair.remote
                          ? [{ value: "remote", label: "Connected version" }]
                          : []),
                      ],
                    })),
                    {
                      key: "reviewReason",
                      label: "Reason for the decision",
                      type: "textarea",
                      required: true,
                    },
                  ]}
                  label="Record review decision"
                  validateValues={(values): Record<string, string> =>
                    str(values.reviewReason).trim().length < 10 ||
                    str(values.reviewReason).length > 1000
                      ? {
                          reviewReason:
                            "Explain the decision in 10 to 1,000 characters.",
                        }
                      : {}
                  }
                  onSubmit={async (values) => {
                    const choices: Record<string, "local" | "remote"> = {};
                    for (const pair of review.records)
                      choices[pair.local.id] = str(values[pair.local.id]) as
                        "local" | "remote";
                    const result = await resolveConflict(
                      review.id,
                      review.token,
                      choices,
                      str(values.reviewReason),
                    );
                    setCacheRefreshed(result.cacheRefreshed);
                    setDone(true);
                    onResolved();
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
