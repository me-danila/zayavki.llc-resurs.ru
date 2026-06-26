import React from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import type { SubmitErrorHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormSchema } from '../types';
import type { FormData } from '../types';
import { EMPTY_ITEM } from '../constants';
import { AppHeader } from '../components/AppHeader';
import { SubmitFooter } from '../components/SubmitFooter';
import { SiteField } from '../components/fields/SiteField';
import { RequestNoField } from '../components/fields/RequestNoField';
import { InitiatorFields } from '../components/fields/InitiatorFields';
import { ItemsSection } from '../components/ItemsSection';

const ZayavkaPage: React.FC = () => {
  const methods = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      requestDate: new Date().toLocaleDateString('ru-RU'),
      items: [EMPTY_ITEM],
    },
  });

  const {
    handleSubmit,
    register,
    formState: { isSubmitting },
  } = methods;

  const onSubmit = async (data: FormData) => {
    try {
      const response = await fetch('/repair/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Ошибка при отправке заявки');
      }

      alert('Заявка успешно отправлена!');
    } catch (error) {
      console.error('Submission error:', error);
      alert('Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже.');
    }
  };

  const onErrors: SubmitErrorHandler<FormData> = (errors) => {
    console.error(errors);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-4 px-4 sm:py-8 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <AppHeader title="Новая заявка" />

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit, onErrors)} className="space-y-6">
            <input type="hidden" {...register('requestDate')} />

            <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <SiteField />
                <RequestNoField />
                <InitiatorFields />
              </div>
            </div>

            <ItemsSection />

            <SubmitFooter isSubmitting={isSubmitting} />
          </form>
        </FormProvider>
      </div>
    </div>
  );
};

export default ZayavkaPage;
