// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
import { AccountConnect } from './account-lifecycle';
describe('AccountConnect',()=>{it('keeps source capabilities separate',()=>{render(<AccountConnect/>);expect(screen.getByText('自有数据导入由 JSON 导入流程创建，不需要官方 OAuth。')).toBeInTheDocument();expect(screen.getByRole('button',{name:'官方 API 尚未配置'})).toBeDisabled();fireEvent.change(screen.getByLabelText('演示账号标识'),{target:{value:'demo-id'}});fireEvent.change(screen.getByLabelText('演示凭据'),{target:{value:'demo-secret'}});expect(screen.getByRole('button',{name:'创建演示账号'})).toBeEnabled();});});
