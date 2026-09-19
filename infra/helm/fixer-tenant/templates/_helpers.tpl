{{- define "fixer-tenant.fullname" -}}
{{ required "tenant.slug is required (e.g. \"oficina-silva\")" .Values.tenant.slug }}
{{- end -}}

{{- define "fixer-tenant.labels" -}}
app.kubernetes.io/part-of: fixer
fixer.io/tenant: {{ .Values.tenant.slug }}
{{- end -}}
