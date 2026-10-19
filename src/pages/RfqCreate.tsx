import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page } from "../components/guards";
import { RfqForm } from "../components/RfqForm";
import { Button, ErrorState, PageHeader, SkeletonBlock } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { api, ApiError, errorMessage } from "../lib/api";
import { rfqFormPayload, type RfqFormValues } from "../lib/rfq";
import type { RfqDetail, RfqDetailResponse } from "../lib/types";
import { useApi, useApiMutation } from "../lib/useApi";

export default function RfqCreate() {
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId);
  const navigate = useNavigate();
  const toast = useToast();

  const detail = useApi<RfqDetailResponse>(isEdit ? `/rfqs/${editingId}` : null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useApiMutation(
    async (variables: { values: RfqFormValues; intent: "draft" | "publish" }) => {
      const payload = rfqFormPayload(variables.values);

      if (isEdit) {
        await api.put(`/rfqs/${editingId}`, payload);
        await api.put(`/rfqs/${editingId}/vendors`, { vendorIds: variables.values.vendorIds });
        if (variables.intent === "publish") {
          await api.post(`/rfqs/${editingId}/publish`);
        }
        return api.get<RfqDetailResponse>(`/rfqs/${editingId}`);
      }

      const created = await api.post<{ rfq: RfqDetail }>("/rfqs", {
        ...payload,
        vendorIds: variables.values.vendorIds,
      });
      if (variables.intent === "publish") {
        await api.post(`/rfqs/${created.rfq.id}/publish`);
      }
      return api.get<RfqDetailResponse>(`/rfqs/${created.rfq.id}`);
    },
    { invalidate: ["/rfqs", "/dashboard"] },
  );

  async function handleSubmit(values: RfqFormValues, intent: "draft" | "publish") {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await save.mutateAsync({ values, intent });
      const reference = result.rfq.reference;
      toast.success(
        intent === "publish" ? "RFQ published" : "Draft saved",
        intent === "publish"
          ? `${reference} is now visible to the assigned vendors.`
          : `${reference} was saved as a draft. Publish it when the requirement is ready.`,
      );
      navigate(`/rfqs/${result.rfq.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields) setFieldErrors(error.fields);
      setSubmitError(errorMessage(error));
    }
  }

  if (isEdit) {
    if (detail.loading) {
      return (
        <div className="page-shell">
          <SkeletonBlock className="mb-4 h-5 w-40" />
          <SkeletonBlock className="mb-6 h-9 w-80" />
          <SkeletonBlock className="h-72" />
        </div>
      );
    }
    if (detail.error) {
      return (
        <div className="page-shell">
          <PageHeader eyebrow="Requests for quotation" title="Edit RFQ" />
          <ErrorState message={detail.error.message} onRetry={detail.refetch} />
        </div>
      );
    }
    if (detail.data && detail.data.rfq.status !== "draft") {
      return (
        <div className="page-shell">
          <PageHeader eyebrow="Requests for quotation" title={`RFQ ${detail.data.rfq.reference}`} />
          <div className="card px-6 py-10 text-center">
            <p className="text-[14px] font-bold text-ink">This RFQ can no longer be edited</p>
            <p className="mx-auto mt-1.5 max-w-md text-[12px] text-muted">
              Only draft RFQs are editable. Published RFQs keep the requirements that were sent to vendors.
            </p>
            <Link to={`/rfqs/${detail.data.rfq.id}`} className="btn btn-ghost btn-sm mt-5 inline-flex">
              View RFQ
            </Link>
          </div>
        </div>
      );
    }
  }

  return (
    <Page>
      <div className="page-shell">
        <Link to="/rfqs" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-brand-600">
          <ArrowLeft size={14} /> Back to RFQs
        </Link>
        <PageHeader
          eyebrow="Requests for quotation"
          title={isEdit && detail.data ? `Edit ${detail.data.rfq.reference}` : "Create RFQ"}
          description="Define the requirement, add line items and choose which vendors may quote. Nothing is visible to vendors until you publish."
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate("/rfqs")}>
              Cancel
            </Button>
          }
        />

        <RfqForm
          key={isEdit ? `edit-${editingId}` : "create"}
          mode={isEdit ? "edit" : "create"}
          initial={isEdit ? detail.data?.rfq ?? null : null}
          saving={save.isPending}
          submitError={submitError}
          fieldErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/rfqs")}
        />
      </div>
    </Page>
  );
}
