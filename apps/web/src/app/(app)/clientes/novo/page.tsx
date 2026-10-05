import { CustomerForm } from './customer-form';

export default function NovoClientePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Novo cliente</h1>
      <CustomerForm />
    </section>
  );
}
