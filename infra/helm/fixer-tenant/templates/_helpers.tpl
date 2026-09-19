{{- define "fixer-tenant.fullname" -}}
{{ .Values.tenant.slug }}
{{- end -}}

{{- define "fixer-tenant.labels" -}}
app.kubernetes.io/part-of: fixer
fixer.io/tenant: {{ .Values.tenant.slug }}
{{- end -}}
