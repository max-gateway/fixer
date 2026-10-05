import { PlateLookupForm } from './plate-lookup-form';

export default function Home() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Consulta de placa</h1>
        <p className="text-sm text-slate-600">
          Busque os dados do veículo para iniciar uma ordem de serviço.
        </p>
      </div>
      <PlateLookupForm />
    </section>
  );
}
