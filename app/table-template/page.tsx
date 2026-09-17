"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  Edit,
  Trash2,
  CalendarIcon,
  DollarSign,
  TrendingUp,
  TrendingDown,
  User,
  Plus,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Empty,
  EmptyHeader,
  EmptyContent,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

// Sample data type
interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: "active" | "inactive" | "pending";
  salary: number;
  joinDate: string;
  location: string;
  phone: string;
  performance: number; // -100 to 100
}

// Sample data
const sampleData: Employee[] = [
  {
    id: "1",
    name: "John Doe",
    email: "john.doe@example.com",
    role: "Software Engineer",
    department: "Engineering",
    status: "active",
    salary: 85000,
    joinDate: "2022-03-15",
    location: "New York",
    phone: "+1 234-567-8901",
    performance: 75,
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    role: "Product Manager",
    department: "Product",
    status: "active",
    salary: 95000,
    joinDate: "2021-07-22",
    location: "San Francisco",
    phone: "+1 234-567-8902",
    performance: 85,
  },
  {
    id: "3",
    name: "Mike Johnson",
    email: "mike.j@example.com",
    role: "UX Designer",
    department: "Design",
    status: "inactive",
    salary: 75000,
    joinDate: "2023-01-10",
    location: "Los Angeles",
    phone: "+1 234-567-8903",
    performance: -10,
  },
  {
    id: "4",
    name: "Sarah Williams",
    email: "sarah.w@example.com",
    role: "Marketing Manager",
    department: "Marketing",
    status: "active",
    salary: 80000,
    joinDate: "2022-11-05",
    location: "Chicago",
    phone: "+1 234-567-8904",
    performance: 60,
  },
  {
    id: "5",
    name: "Tom Brown",
    email: "tom.brown@example.com",
    role: "DevOps Engineer",
    department: "Engineering",
    status: "pending",
    salary: 90000,
    joinDate: "2023-06-20",
    location: "Austin",
    phone: "+1 234-567-8905",
    performance: 40,
  },
];

// Get status badge color
const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
      return "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300";
    case "inactive":
      return "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300";
    case "pending":
      return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300";
    default:
      return "bg-muted text-muted-foreground";
  }
};

// Click-to-edit cell. Renders a value (or a custom display) that turns into an
// input on click and commits on blur/Enter.
function EditableCell({
  value,
  onSave,
  type = "text",
  ariaLabel,
  inputClassName,
  displayClassName,
  renderDisplay,
  inputProps,
}: {
  value: string | number;
  onSave: (value: string) => void;
  type?: "text" | "number";
  ariaLabel?: string;
  inputClassName?: string;
  displayClassName?: string;
  renderDisplay?: () => React.ReactNode;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  const commit = () => {
    setEditing(false);
    if (draft !== String(value ?? "")) onSave(draft);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(String(value ?? ""));
            setEditing(false);
          }
        }}
        onWheel={type === "number" ? (e) => e.currentTarget.blur() : undefined}
        className={cn("h-7 px-2 py-0", inputClassName)}
        {...inputProps}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value ?? ""));
        setEditing(true);
      }}
      aria-label={ariaLabel}
      className={cn(
        "-mx-1 w-full cursor-text rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        displayClassName
      )}
    >
      {renderDisplay
        ? renderDisplay()
        : String(value ?? "") || (
            <span className="text-muted-foreground italic">—</span>
          )}
    </button>
  );
}

// Inline status editor: shows the colored badge, opens a Select on click.
function StatusCell({
  value,
  onSave,
}: {
  value: Employee["status"];
  onSave: (value: Employee["status"]) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Select
        defaultOpen
        value={value}
        onValueChange={(v) => {
          onSave(v as Employee["status"]);
          setEditing(false);
        }}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit status"
      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize",
          getStatusColor(value)
        )}
      >
        {value}
      </span>
    </button>
  );
}

const columnHelper = createColumnHelper<Employee>();

export default function TableTemplate() {
  const [data, setData] = useState<Employee[]>(sampleData);
  const [searchTerm, setSearchTerm] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    document.title = "Table Template";
  }, []);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<Employee[]>([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEdit, setBulkEdit] = useState({
    statusEnabled: false,
    status: "active" as Employee["status"],
    departmentEnabled: false,
    department: "",
    roleEnabled: false,
    role: "",
    locationEnabled: false,
    location: "",
  });
  // Form state for new employee
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    role: "",
    department: "",
    status: "active" as "active" | "inactive" | "pending",
    salary: "",
    joinDate: new Date().toISOString().split("T")[0],
    location: "",
    phone: "",
    performance: "0",
  });
  const [formErrors, setFormErrors] = useState({
    name: false,
    email: false,
    role: false,
    department: false,
    salary: false,
    location: false,
    phone: false,
  });

  // Update a single employee field (used by inline editing).
  const updateEmployee = (id: string, patch: Partial<Employee>) => {
    setData((prev) =>
      prev.map((emp) => (emp.id === id ? { ...emp, ...patch } : emp))
    );
  };

  // Filter by status before passing to TanStack Table
  const filteredByStatus = useMemo(() => {
    if (filterStatus === "all") return data;
    return data.filter((row) => row.status === filterStatus);
  }, [data, filterStatus]);

  // Column definitions
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        size: 44,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
            aria-label="Select all rows"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
      }),
      columnHelper.accessor("name", {
        size: 240,
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-4"
          >
            Employee
            {column.getIsSorted() === "asc" ? (
              <ChevronUp className="ml-1 h-3 w-3" />
            ) : column.getIsSorted() === "desc" ? (
              <ChevronDown className="ml-1 h-3 w-3" />
            ) : null}
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <EditableCell
              value={row.original.name}
              onSave={(v) => updateEmployee(row.original.id, { name: v })}
              ariaLabel="Edit name"
              displayClassName="block truncate text-sm font-medium text-foreground"
              inputClassName="text-sm font-medium"
            />
            <EditableCell
              value={row.original.department}
              onSave={(v) => updateEmployee(row.original.id, { department: v })}
              ariaLabel="Edit department"
              displayClassName="block truncate text-xs text-muted-foreground"
              inputClassName="h-6 text-xs"
            />
          </div>
        ),
      }),
      columnHelper.accessor("role", {
        size: 220,
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-4"
          >
            Role
            {column.getIsSorted() === "asc" ? (
              <ChevronUp className="ml-1 h-3 w-3" />
            ) : column.getIsSorted() === "desc" ? (
              <ChevronDown className="ml-1 h-3 w-3" />
            ) : null}
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <EditableCell
              value={row.original.role}
              onSave={(v) => updateEmployee(row.original.id, { role: v })}
              ariaLabel="Edit role"
              displayClassName="block truncate text-sm text-foreground"
              inputClassName="text-sm"
            />
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                  >
                    <CalendarIcon className="h-3 w-3" />
                    <span>
                      {new Date(row.original.joinDate).toLocaleDateString()}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(row.original.joinDate + "T00:00:00")}
                    onSelect={(date) => {
                      if (date) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(
                          2,
                          "0"
                        );
                        const day = String(date.getDate()).padStart(2, "0");
                        updateEmployee(row.original.id, {
                          joinDate: `${year}-${month}-${day}`,
                        });
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor("status", {
        size: 130,
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusCell
            value={row.original.status}
            onSave={(status) => updateEmployee(row.original.id, { status })}
          />
        ),
      }),
      columnHelper.accessor("salary", {
        size: 150,
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="-ml-4"
          >
            Salary
            {column.getIsSorted() === "asc" ? (
              <ChevronUp className="ml-1 h-3 w-3" />
            ) : column.getIsSorted() === "desc" ? (
              <ChevronDown className="ml-1 h-3 w-3" />
            ) : null}
          </Button>
        ),
        cell: ({ row }) => (
          <EditableCell
            value={row.original.salary}
            onSave={(v) =>
              updateEmployee(row.original.id, {
                salary: Math.max(0, parseInt(v) || 0),
              })
            }
            type="number"
            ariaLabel="Edit salary"
            inputClassName="w-28"
            inputProps={{ min: 0 }}
            renderDisplay={() => (
              <span className="flex items-center gap-1">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {row.original.salary.toLocaleString()}
                </span>
              </span>
            )}
          />
        ),
      }),
      columnHelper.accessor("performance", {
        size: 150,
        header: "Performance",
        enableSorting: false,
        cell: ({ row }) => (
          <EditableCell
            value={row.original.performance}
            onSave={(v) => {
              const parsed = parseInt(v) || 0;
              updateEmployee(row.original.id, {
                performance: Math.max(-100, Math.min(100, parsed)),
              });
            }}
            type="number"
            ariaLabel="Edit performance"
            inputClassName="w-24"
            inputProps={{ min: -100, max: 100 }}
            renderDisplay={() => (
              <span className="flex items-center gap-2">
                {row.original.performance > 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
                <span
                  className={cn(
                    "text-sm font-medium",
                    row.original.performance > 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  {Math.abs(row.original.performance)}%
                </span>
              </span>
            )}
          />
        ),
      }),
      columnHelper.display({
        id: "actions",
        size: 64,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleDeleteClick(row.original)}
              className="hover:text-destructive"
              aria-label="Delete employee"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      }),
    ],
    []
  );

  // TanStack Table instance
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoizable functions
  const table = useReactTable({
    data: filteredByStatus,
    columns,
    state: { sorting, globalFilter: searchTerm, rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearchTerm,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, filterValue) => {
      const search = filterValue.toLowerCase();
      return (
        row.original.name.toLowerCase().includes(search) ||
        row.original.email.toLowerCase().includes(search) ||
        row.original.role.toLowerCase().includes(search) ||
        row.original.department.toLowerCase().includes(search)
      );
    },
  });

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

  // Validate form
  const validateForm = () => {
    const errors = {
      name: !formData.name.trim(),
      email: !formData.email.trim(),
      role: !formData.role.trim(),
      department: !formData.department.trim(),
      salary: !formData.salary.trim(),
      location: !formData.location.trim(),
      phone: !formData.phone.trim(),
    };

    setFormErrors(errors);
    return !Object.values(errors).some((error) => error);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      role: "",
      department: "",
      status: "active",
      salary: "",
      joinDate: new Date().toISOString().split("T")[0],
      location: "",
      phone: "",
      performance: "0",
    });
    setFormErrors({
      name: false,
      email: false,
      role: false,
      department: false,
      salary: false,
      location: false,
      phone: false,
    });
  };

  // Handle add employee
  const handleAddEmployee = () => {
    if (!validateForm()) return;

    const newEmployee: Employee = {
      id: (data.length + 1).toString(),
      name: formData.name,
      email: formData.email,
      role: formData.role,
      department: formData.department,
      status: formData.status,
      salary: parseInt(formData.salary),
      joinDate: formData.joinDate,
      location: formData.location,
      phone: formData.phone,
      performance: parseInt(formData.performance),
    };

    setData([...data, newEmployee]);
    setShowAddModal(false);
    resetForm();
  };

  // Handle single delete click
  const handleDeleteClick = (employee: Employee) => {
    setDeleteTargets([employee]);
    setShowDeleteModal(true);
  };

  // Handle bulk delete click
  const handleBulkDeleteClick = () => {
    setDeleteTargets(selectedRows.map((row) => row.original));
    setShowDeleteModal(true);
  };

  // Handle confirm delete (single or bulk)
  const handleConfirmDelete = () => {
    const ids = new Set(deleteTargets.map((emp) => emp.id));
    setData((prev) => prev.filter((emp) => !ids.has(emp.id)));
    setRowSelection({});
    setShowDeleteModal(false);
    setDeleteTargets([]);
  };

  // Open the bulk edit dialog with a clean slate
  const openBulkEdit = () => {
    setBulkEdit({
      statusEnabled: false,
      status: "active",
      departmentEnabled: false,
      department: "",
      roleEnabled: false,
      role: "",
      locationEnabled: false,
      location: "",
    });
    setShowBulkEditModal(true);
  };

  // Apply enabled fields to all selected rows
  const handleBulkEditApply = () => {
    const ids = new Set(selectedRows.map((row) => row.original.id));
    setData((prev) =>
      prev.map((emp) => {
        if (!ids.has(emp.id)) return emp;
        const patch: Partial<Employee> = {};
        if (bulkEdit.statusEnabled) patch.status = bulkEdit.status;
        if (bulkEdit.departmentEnabled) patch.department = bulkEdit.department;
        if (bulkEdit.roleEnabled) patch.role = bulkEdit.role;
        if (bulkEdit.locationEnabled) patch.location = bulkEdit.location;
        return { ...emp, ...patch };
      })
    );
    setShowBulkEditModal(false);
  };

  const bulkEditHasChanges =
    bulkEdit.statusEnabled ||
    bulkEdit.departmentEnabled ||
    bulkEdit.roleEnabled ||
    bulkEdit.locationEnabled;

  // Reusable form fields renderer (Add employee)
  const renderFormFields = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="form-name">
          Full Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-name"
          value={formData.name}
          onChange={(e) => {
            setFormData({ ...formData, name: e.target.value });
            if (formErrors.name) setFormErrors({ ...formErrors, name: false });
          }}
          placeholder="John Doe"
          aria-invalid={formErrors.name}
        />
        {formErrors.name && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="form-email">
          Email <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-email"
          type="email"
          value={formData.email}
          onChange={(e) => {
            setFormData({ ...formData, email: e.target.value });
            if (formErrors.email)
              setFormErrors({ ...formErrors, email: false });
          }}
          placeholder="john@example.com"
          aria-invalid={formErrors.email}
        />
        {formErrors.email && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-2">
        <Label htmlFor="form-role">
          Role <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-role"
          value={formData.role}
          onChange={(e) => {
            setFormData({ ...formData, role: e.target.value });
            if (formErrors.role) setFormErrors({ ...formErrors, role: false });
          }}
          placeholder="Software Engineer"
          aria-invalid={formErrors.role}
        />
        {formErrors.role && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Department */}
      <div className="space-y-2">
        <Label htmlFor="form-department">
          Department <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-department"
          value={formData.department}
          onChange={(e) => {
            setFormData({ ...formData, department: e.target.value });
            if (formErrors.department)
              setFormErrors({ ...formErrors, department: false });
          }}
          placeholder="Engineering"
          aria-invalid={formErrors.department}
        />
        {formErrors.department && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Status */}
      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={formData.status}
          onValueChange={(value) =>
            setFormData({
              ...formData,
              status: value as "active" | "inactive" | "pending",
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Salary */}
      <div className="space-y-2">
        <Label htmlFor="form-salary">
          Salary <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-salary"
          type="number"
          value={formData.salary}
          onChange={(e) => {
            setFormData({ ...formData, salary: e.target.value });
            if (formErrors.salary)
              setFormErrors({ ...formErrors, salary: false });
          }}
          onWheel={(e) => e.currentTarget.blur()}
          placeholder="75000"
          aria-invalid={formErrors.salary}
        />
        {formErrors.salary && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Join Date */}
      <div className="space-y-2">
        <Label>Join Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !formData.joinDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="h-4 w-4" />
              {formData.joinDate
                ? new Date(formData.joinDate + "T00:00:00").toLocaleDateString()
                : "Select date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={
                formData.joinDate
                  ? new Date(formData.joinDate + "T00:00:00")
                  : undefined
              }
              onSelect={(date) => {
                if (date) {
                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, "0");
                  const day = String(date.getDate()).padStart(2, "0");
                  setFormData({
                    ...formData,
                    joinDate: `${year}-${month}-${day}`,
                  });
                }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label htmlFor="form-location">
          Location <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-location"
          value={formData.location}
          onChange={(e) => {
            setFormData({ ...formData, location: e.target.value });
            if (formErrors.location)
              setFormErrors({ ...formErrors, location: false });
          }}
          placeholder="New York"
          aria-invalid={formErrors.location}
        />
        {formErrors.location && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-2">
        <Label htmlFor="form-phone">
          Phone <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form-phone"
          type="tel"
          value={formData.phone}
          onChange={(e) => {
            setFormData({ ...formData, phone: e.target.value });
            if (formErrors.phone)
              setFormErrors({ ...formErrors, phone: false });
          }}
          placeholder="+1 234-567-8900"
          aria-invalid={formErrors.phone}
        />
        {formErrors.phone && (
          <p className="text-xs text-destructive">This field is required</p>
        )}
      </div>

      {/* Performance */}
      <div className="space-y-2">
        <Label htmlFor="form-performance">Performance (%)</Label>
        <Input
          id="form-performance"
          type="number"
          value={formData.performance}
          onChange={(e) =>
            setFormData({ ...formData, performance: e.target.value })
          }
          onWheel={(e) => e.currentTarget.blur()}
          min={-100}
          max={100}
          placeholder="0"
        />
      </div>
    </div>
  );

  const totalRows = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          Table Template
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A comprehensive table example with inline editing, sorting, filtering,
          and bulk actions
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 space-y-4">
        {/* Search and Actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, role, or department..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4" />
              Filters
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setShowAddModal(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Employee
            </Button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="overflow-auto flex-1 relative">
          <Table
            className="table-fixed"
            style={{ minWidth: table.getTotalSize() }}
          >
            <TableHeader className="bg-muted sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className="hover:bg-muted/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-3 py-1.5">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-12">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <User className="h-5 w-5" />
                        </EmptyMedia>
                        <EmptyTitle>No employees found</EmptyTitle>
                        <EmptyDescription>
                          {searchTerm || filterStatus !== "all"
                            ? "Try adjusting your search or filter criteria."
                            : "Get started by adding your first employee."}
                        </EmptyDescription>
                      </EmptyHeader>
                      {!searchTerm && filterStatus === "all" && (
                        <EmptyContent>
                          <Button
                            onClick={() => {
                              resetForm();
                              setShowAddModal(true);
                            }}
                          >
                            <Plus className="h-4 w-4" />
                            Add Employee
                          </Button>
                        </EmptyContent>
                      )}
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Row count */}
        <div className="px-6 py-3 border-t border-border mt-auto">
          <div className="text-sm text-muted-foreground">
            {selectedCount > 0 && (
              <span className="text-foreground font-medium">
                {selectedCount} of{" "}
              </span>
            )}
            {totalRows} {totalRows === 1 ? "result" : "results"}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
              <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-foreground font-medium">
                {deleteTargets.length === 1
                  ? "Are you sure you want to delete this employee?"
                  : `Are you sure you want to delete ${deleteTargets.length} employees?`}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone. The following will be permanently
                removed:
              </p>
              {deleteTargets.length === 1 ? (
                <div className="mt-3 p-3 bg-muted rounded-md">
                  <p className="text-sm font-medium text-foreground">
                    {deleteTargets[0].name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {deleteTargets[0].role} &bull; {deleteTargets[0].department}
                  </p>
                </div>
              ) : (
                <div className="mt-3 p-3 bg-muted rounded-md max-h-40 overflow-y-auto space-y-1">
                  {deleteTargets.map((emp) => (
                    <p
                      key={emp.id}
                      className="text-sm text-foreground truncate"
                    >
                      {emp.name}{" "}
                      <span className="text-muted-foreground">
                        — {emp.role}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {deleteTargets.length === 1
                ? "Delete Employee"
                : `Delete ${deleteTargets.length} Employees`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Dialog */}
      <Dialog open={showBulkEditModal} onOpenChange={setShowBulkEditModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {selectedCount} employees</DialogTitle>
            <DialogDescription>
              Enable a field to apply the same value to all selected employees.
              Disabled fields are left unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="bulk-status"
                checked={bulkEdit.statusEnabled}
                onCheckedChange={(value) =>
                  setBulkEdit({ ...bulkEdit, statusEnabled: !!value })
                }
                aria-label="Update status"
              />
              <Label
                htmlFor="bulk-status"
                className="w-28 shrink-0 cursor-pointer"
              >
                Status
              </Label>
              <Select
                value={bulkEdit.status}
                onValueChange={(value) =>
                  setBulkEdit({
                    ...bulkEdit,
                    status: value as Employee["status"],
                    statusEnabled: true,
                  })
                }
                disabled={!bulkEdit.statusEnabled}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Department */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="bulk-department"
                checked={bulkEdit.departmentEnabled}
                onCheckedChange={(value) =>
                  setBulkEdit({ ...bulkEdit, departmentEnabled: !!value })
                }
                aria-label="Update department"
              />
              <Label
                htmlFor="bulk-department"
                className="w-28 shrink-0 cursor-pointer"
              >
                Department
              </Label>
              <Input
                value={bulkEdit.department}
                onChange={(e) =>
                  setBulkEdit({
                    ...bulkEdit,
                    department: e.target.value,
                    departmentEnabled: true,
                  })
                }
                disabled={!bulkEdit.departmentEnabled}
                placeholder="Engineering"
                className="flex-1"
              />
            </div>

            {/* Role */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="bulk-role"
                checked={bulkEdit.roleEnabled}
                onCheckedChange={(value) =>
                  setBulkEdit({ ...bulkEdit, roleEnabled: !!value })
                }
                aria-label="Update role"
              />
              <Label
                htmlFor="bulk-role"
                className="w-28 shrink-0 cursor-pointer"
              >
                Role
              </Label>
              <Input
                value={bulkEdit.role}
                onChange={(e) =>
                  setBulkEdit({
                    ...bulkEdit,
                    role: e.target.value,
                    roleEnabled: true,
                  })
                }
                disabled={!bulkEdit.roleEnabled}
                placeholder="Software Engineer"
                className="flex-1"
              />
            </div>

            {/* Location */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="bulk-location"
                checked={bulkEdit.locationEnabled}
                onCheckedChange={(value) =>
                  setBulkEdit({ ...bulkEdit, locationEnabled: !!value })
                }
                aria-label="Update location"
              />
              <Label
                htmlFor="bulk-location"
                className="w-28 shrink-0 cursor-pointer"
              >
                Location
              </Label>
              <Input
                value={bulkEdit.location}
                onChange={(e) =>
                  setBulkEdit({
                    ...bulkEdit,
                    location: e.target.value,
                    locationEnabled: true,
                  })
                }
                disabled={!bulkEdit.locationEnabled}
                placeholder="New York"
                className="flex-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBulkEditModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkEditApply}
              disabled={!bulkEditHasChanges}
            >
              Apply to {selectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Employee Dialog */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>
              Fill in the details to add a new employee.
            </DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddEmployee}>Add Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-lg">
            <span className="pl-2 text-sm font-medium text-foreground">
              {selectedCount} selected
            </span>
            <div className="h-5 w-px bg-border" />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => table.resetRowSelection()}
              >
                Clear
              </Button>
              <Button variant="outline" size="sm" onClick={openBulkEdit}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDeleteClick}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
