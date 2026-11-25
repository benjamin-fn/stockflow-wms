import test from 'node:test';
import assert from 'node:assert/strict';
import {day,money,number,query} from './api.ts';
test('Swedish dates, time zone and amounts',()=>{
  assert.equal(day('2026-11-25T23:15:00Z'),'2026-11-26');
  assert.equal(day('2026-11-25'),'2026-11-25');
  assert.equal(number(1234.5),'1\u00a0234,5');
  assert.match(money(1250),/1\s250\skr/);
});
test('Empty filters are omitted and search is encoded',()=>{
  assert.equal(query({page:2,category:'',search:'Blå låda'}),'?page=2&search=Bl%C3%A5+l%C3%A5da');
});
