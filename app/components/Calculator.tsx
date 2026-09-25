'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Delete } from 'lucide-react';

interface CalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Calculator({ open, onOpenChange }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState(true);

  const handleNumber = (num: string) => {
    if (newNumber) {
      setDisplay(num);
      setNewNumber(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const handleDecimal = () => {
    if (newNumber) {
      setDisplay('0.');
      setNewNumber(false);
    } else if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleOperation = (op: string) => {
    const currentValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(currentValue);
    } else if (operation) {
      const result = calculate(previousValue, currentValue, operation);
      setDisplay(String(result));
      setPreviousValue(result);
    }

    setOperation(op);
    setNewNumber(true);
  };

  const calculate = (prev: number, current: number, op: string): number => {
    switch (op) {
      case '+':
        return prev + current;
      case '-':
        return prev - current;
      case '*':
        return prev * current;
      case '/':
        return prev / current;
      case '%':
        return prev % current;
      default:
        return current;
    }
  };

  const handleEquals = () => {
    if (operation && previousValue !== null) {
      const currentValue = parseFloat(display);
      const result = calculate(previousValue, currentValue, operation);
      setDisplay(String(result));
      setPreviousValue(null);
      setOperation(null);
      setNewNumber(true);
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setNewNumber(true);
  };

  const handleBackspace = () => {
    if (display.length === 1) {
      setDisplay('0');
      setNewNumber(true);
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-80 p-0 border-0 shadow-xl">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-white text-center">Calculator</DialogTitle>
          </DialogHeader>

          {/* Display */}
          <div className="bg-slate-950 rounded-lg p-4 mb-4 text-right">
            <div className="text-white text-4xl font-bold truncate">{display}</div>
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-4 gap-2">
            {/* Row 1 */}
            <Button
              onClick={handleClear}
              className="col-span-2 bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              AC
            </Button>
            <Button
              onClick={handleBackspace}
              className="bg-orange-600 hover:bg-orange-700 text-white font-semibold"
            >
              <Delete className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleOperation('/')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg"
            >
              ÷
            </Button>

            {/* Row 2 */}
            <Button
              onClick={() => handleNumber('7')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              7
            </Button>
            <Button
              onClick={() => handleNumber('8')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              8
            </Button>
            <Button
              onClick={() => handleNumber('9')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              9
            </Button>
            <Button
              onClick={() => handleOperation('*')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg"
            >
              ×
            </Button>

            {/* Row 3 */}
            <Button
              onClick={() => handleNumber('4')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              4
            </Button>
            <Button
              onClick={() => handleNumber('5')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              5
            </Button>
            <Button
              onClick={() => handleNumber('6')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              6
            </Button>
            <Button
              onClick={() => handleOperation('-')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg"
            >
              −
            </Button>

            {/* Row 4 */}
            <Button
              onClick={() => handleNumber('1')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              1
            </Button>
            <Button
              onClick={() => handleNumber('2')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              2
            </Button>
            <Button
              onClick={() => handleNumber('3')}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              3
            </Button>
            <Button
              onClick={() => handleOperation('+')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg"
            >
              +
            </Button>

            {/* Row 5 */}
            <Button
              onClick={() => handleNumber('0')}
              className="col-span-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              0
            </Button>
            <Button
              onClick={handleDecimal}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              .
            </Button>
            <Button
              onClick={handleEquals}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold text-lg"
            >
              =
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
